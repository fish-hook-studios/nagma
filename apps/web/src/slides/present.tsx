import { ChevronLeft, ChevronRight, Grid01, Monitor01, Maximize01, X } from "@untitledui/icons";
import { RehearsalSummary, ShowHelp, ShowNavigator, SlideMedia } from "./show-overlays";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { browserId } from "../engine/client-id";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { slideOf, themeOf } from "./model";
import { NotesMarkdown } from "./notes-markdown";
import { useNotesDraft } from "./notes-draft";
import { animationMods, animationSteps, drawMatched, drawSlide, drawTransition, finalMods, sameSignature, slideDataUrl, slideHasVideo, slideSignature, stepLength } from "./render";
import { currentShow, next, onKey, openPresenterView, previous, pruneShow, setShow, stopPresentation, takePresenterViewRequest, useShow, visibleOrder } from "./show";
import { slides } from "./state";
import { LIVE_KINDS, addStamp, answer, videoEmbedUrl } from "./widgets";
import { useCollab } from "../engine/collab";
import type { DeckData, DeckTheme } from "./types";

// Presenting: the slides fill the window in the file's present tab. Arrows, space, Enter or a
// click play the next object animation, then the next slide (with its transition); Esc leaves.
// L shows a laser pointer, B blacks the screen out. Presenter view opens in a window of its own
// with the current and next slide, the notes and a timer.

// ---- The show ----

export function SlidePresenter() {
    const doc = useEditor((s) => s.doc);
    const state = useShow();
    const rehearse = slides.get().rehearse;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
    const [bar, setBar] = useState(false);
    const presentingId = useEditor((s) => s.presentingId);
    const toast = useEditor((s) => s.toast);

    // A show started from the present tab (not the Present menu) begins on that tab's slide.
    useEffect(() => {
        const order = visibleOrder(editor.get().doc);
        const show = currentShow();
        if (!show.order.length || !show.order.every((id) => order.includes(id))) {
            const at = Math.max(0, order.indexOf(presentingId ?? ""));
            const now = performance.now();
            setShow({ order, index: at, shown: 0, stepAt: now, entryAt: now, transition: null, ended: false, startedAt: Date.now(), timings: {}, slideAt: Date.now() });
        }
        if (takePresenterViewRequest() && !currentShow().presenterWindow) openPresenterView();
        window.addEventListener("keydown", onKey, true);
        const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", resize);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("resize", resize);
        };
    }, [presentingId]);

    useEffect(() => {
        pruneShow(doc);
    }, [doc]);

    const id = state.order[state.index];
    const slide = id ? doc.nodes[id] : undefined;
    const fit = slide ? Math.min(size.w / slide.w, size.h / slide.h) : 1;
    const box = slide ? { x: (size.w - slide.w * fit) / 2, y: (size.h - slide.h * fit) / 2, w: slide.w * fit, h: slide.h * fit } : { x: 0, y: 0, w: 0, h: 0 };

    // Draws every frame while something moves, and once otherwise.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !slide) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(box.w * dpr);
        canvas.height = Math.round(box.h * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        let frame = 0;
        const draw = () => {
            const now = performance.now();
            const scale = (box.w * dpr) / slide.w;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            let moving = false;
            const t = state.transition;
            const from = t ? doc.nodes[t.from] : undefined;
            if (t && from && t.to === slide.id && now - t.at < t.spec.duration) {
                const p = (now - t.at) / Math.max(1, t.spec.duration);
                if (t.spec.type === "smart") drawMatched(ctx, doc, from, slide, p, t.spec.easing, scale);
                else
                    drawTransition(
                        ctx,
                        slide.w,
                        slide.h,
                        t.spec,
                        p,
                        () => drawSlide(ctx, doc, from, scale, finalMods(doc, from)),
                        () => drawSlide(ctx, doc, slide, scale, animationMods(doc, slide, 0, 0, 0)),
                    );
                moving = true;
            } else {
                drawSlide(ctx, doc, slide, scale, animationMods(doc, slide, state.shown, now - state.stepAt, now - state.entryAt));
                const steps = animationSteps(slide);
                const current = state.shown > 0 ? steps.clicks[state.shown - 1] : undefined;
                // Playing videos need every frame too.
                moving = (current !== undefined && now - state.stepAt < stepLength(current)) || now - state.entryAt < stepLength(steps.auto) || now < state.entryAt || slideHasVideo(doc, slide);
            }
            if (moving) frame = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(frame);
    }, [doc, slide, state.shown, state.stepAt, state.entryAt, state.transition, box.w, box.h]);

    // A next slide whose transition plays after a delay comes in by itself once this one has finished.
    useEffect(() => {
        const nextId = state.order[state.index + 1];
        const after = nextId ? slideOf(doc.nodes[nextId])?.transition?.after : null;
        if (after == null || state.ended || !slide) return;
        const steps = animationSteps(slide);
        if (state.shown < steps.clicks.length) return;
        const last = state.shown > 0 ? state.stepAt + stepLength(steps.clicks[state.shown - 1] ?? []) : state.entryAt + stepLength(steps.auto);
        const timer = window.setTimeout(next, Math.max(0, last - performance.now()) + after);
        return () => window.clearTimeout(timer);
    }, [doc, slide, state.order, state.index, state.shown, state.stepAt, state.entryAt, state.ended]);

    const theme = themeOf(doc, slide?.id);
    const widgets = slide && !state.transition ? slide.children.map((c) => doc.nodes[c]).filter((n): n is SceneNode => Boolean(n && n.visible && (LIVE_KINDS as string[]).includes(n.deck?.kind ?? ""))) : [];
    const elapsed = useClock(state.startedAt);
    const slideTime = useClock(state.slideAt);

    if (!slide) return null;
    return (
        <div
            data-slides-presenter
            className="fixed inset-0 z-[70] select-none overflow-hidden bg-black"
            style={{ cursor: state.laser ? "none" : bar ? "default" : "none" }}
            onPointerMove={(e) => {
                setPointer({ x: e.clientX, y: e.clientY });
                setBar(e.clientY > window.innerHeight - 90);
            }}
            onClick={(e) => {
                if (e.button === 0) next();
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                previous();
            }}
        >
            <canvas ref={canvasRef} aria-label={`Slide ${state.index + 1} of ${state.order.length}`} className="absolute" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
            {widgets.map((node) => (
                <div
                    key={node.id}
                    className="absolute"
                    style={{ left: box.x + (node.x - slide.x) * fit, top: box.y + (node.y - slide.y) * fit, width: node.w * fit, height: node.h * fit, cursor: "default" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <LiveWidget node={node} theme={theme} k={fit} />
                </div>
            ))}
            <SlideMedia slide={slide} box={box} fit={fit} active={!state.transition && !state.ended} />
            {state.ended && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black text-[15px] text-white/70">
                    {rehearse && <RehearsalSummary />}
                    End of presentation. Click to exit.
                </div>
            )}
            {state.typed && <div className="absolute right-6 top-6 rounded-lg bg-black/70 px-3 py-1.5 font-mono text-[20px] text-white" aria-live="polite">Go to {state.typed}</div>}
            {state.black && <div className="absolute inset-0 bg-black" />}
            {state.laser && pointer && <div className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_14px_6px_rgba(255,40,40,0.65)]" style={{ left: pointer.x, top: pointer.y }} />}
            {rehearse && !state.ended && (
                <div className="absolute left-1/2 top-4 flex -translate-x-1/2 gap-3 rounded-full bg-black/70 px-3 py-1 font-mono text-[14px] text-white" aria-label="Rehearsal timer">
                    <span title="This slide">{slideTime}</span>
                    <span className="text-white/50" title="Whole presentation">{elapsed}</span>
                </div>
            )}
            <div
                className={`absolute bottom-4 left-4 flex items-center gap-1 rounded-xl bg-[#1E1E1E]/90 p-1 text-white shadow-lg transition-opacity ${bar ? "opacity-100" : "opacity-0"}`}
                onClick={(e) => e.stopPropagation()}
            >
                <PresenterButton label="Previous" onClick={previous}><ChevronLeft className="size-4" /></PresenterButton>
                <span className="px-2 text-[12px] tabular-nums" aria-label="Slide counter">{state.index + 1} / {state.order.length}</span>
                <PresenterButton label="Next" onClick={next}><ChevronRight className="size-4" /></PresenterButton>
                <PresenterButton label="Slide navigator (G)" onClick={() => setShow({ navigator: true })}><Grid01 className="size-4" /></PresenterButton>
                <PresenterButton label="Presenter view" onClick={openPresenterView}><Monitor01 className="size-4" /></PresenterButton>
                <PresenterButton label="Shortcuts (?)" onClick={() => setShow({ help: true })}><span className="text-[14px] font-semibold">?</span></PresenterButton>
                <PresenterButton label="Full screen (F)" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.().catch(() => undefined))}><Maximize01 className="size-4" /></PresenterButton>
                <PresenterButton label="Exit (Esc)" onClick={stopPresentation}><X className="size-4" /></PresenterButton>
            </div>
            <ShowNavigator />
            <ShowHelp />
            {state.presenterWindow && createPortal(<PresenterView />, state.presenterWindow.document.body)}
            {state.presenterInline && (
                <div className="absolute inset-0 z-10" style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
                    <PresenterView inline />
                </div>
            )}
            {toast && (
                <div role="status" className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center">
                    <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
                </div>
            )}
        </div>
    );
}

function PresenterButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-lg hover:bg-white/10">
            {children}
        </button>
    );
}

function useClock(since: number): string {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(t);
    }, []);
    const s = Math.max(0, Math.floor((now - since) / 1000));
    const pad = (n: number) => String(n).padStart(2, "0");
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// ---- Live widgets ----

function vote(node: SceneNode, patch: Partial<Extract<DeckData, { kind: "poll" | "scale" | "stamps" }>>) {
    const data = node.deck;
    if (!data) return;
    editor.execute({ type: "node.update", id: node.id, patch: { deck: { ...data, ...patch } as DeckData } });
}


// Shows a poll's or scale's hidden results to everyone.
function RevealButton({ node, k, theme }: { node: SceneNode; k: number; theme: DeckTheme }) {
    if (editor.get().readOnly) return null;
    return (
        <button type="button" onClick={() => vote(node, { hideResults: false })} style={{ fontSize: 24 * k, padding: `${6 * k}px ${16 * k}px`, borderRadius: 10 * k, background: theme.accent, color: theme.background }}>
            Reveal results
        </button>
    );
}

const GLYPHS = ["👍", "❤️", "🎉", "😂", "🤔", "🔥"];

function LiveWidget({ node, theme, k }: { node: SceneNode; theme: DeckTheme; k: number }) {
    const me = browserId();
    const data = node.deck;
    const [glyph, setGlyph] = useState(GLYPHS[0] as string);
    const card = { background: theme.surface, color: theme.text, borderRadius: node.radius * k, fontFamily: theme.bodyFont };
    const title = (text: string) => (
        <div style={{ fontSize: 44 * k, fontWeight: 700, fontFamily: theme.headingFont, padding: `${48 * k}px ${56 * k}px 0` }}>{text}</div>
    );
    if (data?.kind === "poll") {
        const counts = data.options.map((_, i) => Object.values(data.votes).filter((v) => v === i).length);
        const total = Object.values(data.votes).filter((v) => v >= 0 && v < data.options.length).length;
        const hidden = Boolean(data.hideResults);
        return (
            <div className="h-full w-full overflow-hidden" style={card} role="group" aria-label="Poll">
                {title(data.question)}
                <div style={{ padding: `${32 * k}px ${56 * k}px`, display: "flex", flexDirection: "column", gap: 26 * k }}>
                    {data.options.map((option, i) => {
                        const share = total && !hidden ? (counts[i] ?? 0) / total : 0;
                        const mine = data.votes[me] === i;
                        return (
                            <button
                                key={i}
                                type="button"
                                onClick={() => answer(node.id, me, i)}
                                className="relative overflow-hidden text-left"
                                style={{ height: 104 * k, borderRadius: 16 * k, background: theme.background, fontSize: 36 * k, padding: `0 ${36 * k}px`, outline: mine ? `${4 * k}px solid ${theme.accent}` : "none" }}
                            >
                                <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${share * 100}%`, background: theme.accent, opacity: 0.25 }} />
                                <span className="relative flex h-full items-center justify-between">
                                    <span>{option}</span>
                                    {total > 0 && !hidden && <span style={{ color: theme.muted }}>{Math.round(share * 100)}%</span>}
                                </span>
                            </button>
                        );
                    })}
                    <div className="flex items-center justify-between" style={{ fontSize: 26 * k, color: theme.muted }}>
                        <span>{total} vote{total === 1 ? "" : "s"}{hidden ? ", results hidden" : ""}</span>
                        {hidden && <RevealButton node={node} k={k} theme={theme} />}
                    </div>
                </div>
            </div>
        );
    }
    if (data?.kind === "scale") {
        const hidden = Boolean(data.hideResults);
        // Hidden results show only the viewer's own answer.
        const values = Object.entries(data.votes).filter(([who]) => !hidden || who === me);
        const count = Object.keys(data.votes).length;
        const average = values.length && !hidden ? values.reduce((a, [, v]) => a + v, 0) / values.length : null;
        return (
            <div className="h-full w-full overflow-hidden" style={card} role="group" aria-label="Alignment scale">
                {title(data.question)}
                <div
                    className="relative cursor-pointer"
                    style={{ margin: `${80 * k}px ${80 * k}px 0`, height: 80 * k }}
                    onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        answer(node.id, me, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
                    }}
                >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ height: 12 * k, borderRadius: 6 * k, background: theme.muted }} />
                    {values.map(([who, v]) => (
                        <div key={who} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${v * 100}%`, width: 36 * k, height: 36 * k, background: who === me ? theme.accent : theme.text, opacity: who === me ? 1 : 0.5 }} />
                    ))}
                    {average !== null && <div className="absolute top-0 -translate-x-1/2" style={{ left: `${average * 100}%`, width: 4 * k, height: 80 * k, background: theme.accent }} title="Average" />}
                </div>
                <div className="flex justify-between" style={{ padding: `${28 * k}px ${56 * k}px`, fontSize: 32 * k, color: theme.muted }}>
                    <span>{data.left}</span>
                    <span className="flex items-center" style={{ gap: 16 * k }}>
                        {count} response{count === 1 ? "" : "s"}
                        {hidden && <RevealButton node={node} k={k} theme={theme} />}
                    </span>
                    <span>{data.right}</span>
                </div>
            </div>
        );
    }
    if (data?.kind === "stamps") {
        return (
            <div
                className="relative h-full w-full cursor-crosshair overflow-hidden"
                style={card}
                role="group"
                aria-label="Live stamps"
                onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    addStamp(node.id, { id: Math.random().toString(36).slice(2, 9), who: me, glyph, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
                }}
            >
                {title(data.prompt)}
                {data.stamps.map((s) => (
                    <span key={s.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, fontSize: 72 * k }}>{s.glyph}</span>
                ))}
                <div className="absolute flex" style={{ left: 56 * k, bottom: 40 * k, gap: 12 * k }} onClick={(e) => e.stopPropagation()}>
                    {GLYPHS.map((g) => (
                        <button key={g} type="button" aria-label={`Stamp ${g}`} onClick={() => setGlyph(g)} style={{ fontSize: 40 * k, width: 72 * k, height: 72 * k, borderRadius: 36 * k, background: g === glyph ? theme.background : "transparent" }}>{g}</button>
                    ))}
                </div>
            </div>
        );
    }
    if (data?.kind === "facepile") return <Facepile k={k} theme={theme} radius={node.radius} />;
    if (data?.kind === "video-link") {
        return data.url ? (
            <iframe title="Video" src={videoEmbedUrl(data.url, data.start, data.autoplay)} className="h-full w-full border-0 bg-black" style={{ borderRadius: node.radius * k }} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : null;
    }
    if (data?.kind === "embed") {
        const ok = /^https?:\/\//.test(data.url);
        return ok ? (
            <iframe title="Embed" src={data.url} className="h-full w-full border-0 bg-white" style={{ borderRadius: node.radius * k }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        ) : null;
    }
    return null;
}

// Everyone watching: you and the people in the file, as faces in a row (more than eight: a count).
function Facepile({ k, theme, radius }: { k: number; theme: DeckTheme; radius: number }) {
    const me = useCollab((s) => s.me);
    const peers = useCollab((s) => s.peers);
    const viewers = useCollab((s) => s.viewers);
    const people = [{ id: "me", name: me.name || "You", color: me.color }, ...Object.values(peers).map((p) => ({ id: p.userId, name: p.name, color: p.color }))];
    const extra = Math.max(0, people.length - 8) + viewers.filter((v) => !people.some((p) => p.name === v.name)).length;
    return (
        <div className="flex h-full w-full items-center overflow-hidden" style={{ background: theme.surface, borderRadius: radius * k, padding: `0 ${60 * k}px`, gap: 16 * k }} role="group" aria-label="Facepile">
            <div className="flex" style={{ marginRight: 24 * k }}>
                {people.slice(0, 8).map((p, i) => (
                    <span key={p.id} title={p.name} className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: 140 * k, height: 140 * k, marginLeft: i ? -30 * k : 0, background: p.color, border: `${8 * k}px solid ${theme.surface}`, fontSize: 56 * k }}>
                        {(p.name || "?").charAt(0).toUpperCase()}
                    </span>
                ))}
            </div>
            <span style={{ fontSize: 36 * k, color: theme.muted }}>{extra ? `+${extra} more` : `${people.length} watching`}</span>
        </div>
    );
}

// ---- Presenter view (its own window) ----
// Pictures of slides for the presenter view (an image, since its window has none of our fonts).
const pictures = new Map<string, { sig: SceneNode[]; url: string }>();
function slidePicture(doc: NagmaDocument, id: string | undefined, width: number): string | null {
    if (!id || !doc.nodes[id]) return null;
    const key = `${id}@${width}`;
    const sig = slideSignature(doc, id);
    const cached = pictures.get(key);
    if (cached && sameSignature(cached.sig, sig)) return cached.url;
    const url = slideDataUrl(doc, id, width);
    pictures.set(key, { sig, url });
    return url;
}

function PresenterView({ inline = false }: { inline?: boolean }) {
    const doc = useEditor((s) => s.doc);
    const state = useShow();
    const id = state.order[state.index];
    const nextId = state.order[state.index + 1];
    const current = slidePicture(doc, id, 960);
    const upcoming = slidePicture(doc, nextId, 480);
    const notes = slideOf(id ? doc.nodes[id] : undefined)?.notes ?? "";
    const steps = animationSteps(id ? doc.nodes[id] : undefined).clicks.length;
    const [restart, setRestart] = useState(state.startedAt);
    const [editing, setEditing] = useState(false);
    const draft = useNotesDraft(id, notes);
    const readOnly = useEditor((s) => s.readOnly);
    const elapsed = useClock(restart);
    const button = "h-9 rounded-lg bg-white/10 px-3 text-[13px] font-medium hover:bg-white/20";
    return (
        <div className="flex h-screen flex-col gap-4 bg-[#141416] p-5 text-white" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
            <div className="flex items-center gap-3">
                <span className="text-[13px] text-white/60">Presenter view</span>
                <span className="flex-1" />
                <span className="font-mono text-[22px] tabular-nums" aria-label="Elapsed time">{elapsed}</span>
                <button type="button" className={button} onClick={() => setRestart(Date.now())}>Reset timer</button>
                {inline && <button type="button" className={button} onClick={() => setShow({ presenterInline: false })}>Show slides (P)</button>}
                <button type="button" className="h-9 rounded-lg bg-[#F24E1E] px-3 text-[13px] font-semibold hover:bg-[#DA4419]" onClick={stopPresentation}>End show</button>
            </div>
            <div className="flex min-h-0 flex-1 gap-5">
                <div className="flex min-w-0 flex-[2] flex-col gap-2">
                    <div className="text-[12px] uppercase tracking-wide text-white/50">Current slide {state.index + 1} of {state.order.length}{steps ? ` (step ${state.shown} of ${steps})` : ""}</div>
                    {current && <img alt="Current slide" src={current} className="w-full rounded-lg" />}
                    <div className="flex gap-2">
                        <button type="button" className={button} onClick={previous}>Previous</button>
                        <button type="button" className={button} onClick={next}>Next</button>
                    </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="text-[12px] uppercase tracking-wide text-white/50">Next</div>
                    {upcoming ? <img alt="Next slide" src={upcoming} className="w-full rounded-lg opacity-90" /> : <div className="flex aspect-video items-center justify-center rounded-lg bg-white/5 text-[13px] text-white/50">End of presentation</div>}
                    <div className="mt-2 flex items-center justify-between text-[12px] uppercase tracking-wide text-white/50">
                        <span>Notes</span>
                        {!readOnly && id && (
                            <button type="button" className="rounded px-2 py-0.5 normal-case tracking-normal text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setEditing(!editing)}>
                                {editing ? "Done" : "Edit notes"}
                            </button>
                        )}
                    </div>
                    {editing && id ? (
                        <textarea
                            aria-label="Speaker notes"
                            value={draft.text}
                            autoFocus
                            onChange={(e) => draft.type(e.target.value)}
                            onBlur={(e) => draft.leave(e.target.value)}
                            // Esc leaves the notes (Done); the next Esc ends the show.
                            onKeyDown={(e) => {
                                if (e.key !== "Escape") return;
                                e.preventDefault();
                                e.stopPropagation();
                                e.currentTarget.blur();
                                setEditing(false);
                            }}
                            className="min-h-0 flex-1 resize-none rounded-lg bg-white/10 p-3 text-[18px] leading-relaxed text-white outline-none"
                        />
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-white/5 p-3 text-[18px] leading-relaxed" aria-label="Speaker notes">{notes ? <NotesMarkdown text={notes} /> : <span className="text-white/40">No notes for this slide.</span>}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

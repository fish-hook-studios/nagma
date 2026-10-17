import { ArrowLeft, ArrowRight, LinkExternal01, RefreshCw01, XClose } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editor, useEditor } from "../engine/store";
import { buildSite, type BuiltPage } from "./html";
import { breakpointsOf, pageData } from "./model";
import { openPreview } from "./preview";
import { site, useSite } from "./state";

// The inline preview (⇧Space): the built site in a sandboxed frame over the canvas, with back and
// forward through the pages visited, a button per breakpoint that snaps the width to it, handles to
// drag the width by hand (snapping near breakpoints) and a scale. It follows edits as you make them.

const SNAP = 12;
const SCALES = [{ id: "fit", label: "Fit" }, ...[0.5, 0.75, 1, 1.25].map((v) => ({ id: String(v), label: `${Math.round(v * 100)}%` }))];

export function InlinePreview() {
    const open = useSite((s) => s.inlinePreview);
    if (!open) return null;
    return <Panel />;
}

function Panel() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const list = breakpointsOf(doc, pageId);
    const start = (() => {
        const data = pageData(doc.nodes[pageId]);
        return data?.notFound ? "/404" : (data?.path ?? "/");
    })();
    const [pages, setPages] = useState<BuiltPage[] | null>(null);
    const [history, setHistory] = useState<{ stack: string[]; at: number }>({ stack: [start], at: 0 });
    const view = site.get().view;
    const [width, setWidth] = useState<number>(() => list.find((b) => b.id === view)?.width ?? list[0]?.width ?? 1280);
    const [scale, setScale] = useState("fit");
    const [avail, setAvail] = useState({ w: 1000, h: 700 });
    const [dragging, setDragging] = useState(false);
    const stage = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const current = history.stack[history.at] ?? "/";

    // Built pages, again a moment after each edit.
    useEffect(() => {
        let alive = true;
        const build = () => void buildSite(editor.get().doc, "preview").then((b) => alive && setPages(b.pages));
        build();
        let last = editor.get().doc;
        let timer: number | undefined;
        const off = editor.subscribe(() => {
            const next = editor.get().doc;
            if (next === last) return;
            last = next;
            window.clearTimeout(timer);
            timer = window.setTimeout(build, 600);
        });
        return () => {
            alive = false;
            window.clearTimeout(timer);
            off();
        };
    }, []);

    useLayoutEffect(() => {
        const el = stage.current;
        if (!el) return;
        const measure = () => setAvail({ w: el.clientWidth - 48, h: el.clientHeight - 24 });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const go = (path: string) => setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), path], at: h.at + 1 }));
    // Links between pages inside the frame come up as messages.
    useEffect(() => {
        const onMessage = (e: MessageEvent<{ type?: string; to?: string }>) => {
            if (e.source !== frame.current?.contentWindow) return;
            if (e.data?.type === "site-preview-nav" && typeof e.data.to === "string") {
                const [path, anchor] = e.data.to.split("#");
                pendingAnchor.current = anchor ?? null;
                go(path || "/");
            }
            if (e.data?.type === "site-preview-back") setHistory((h) => ({ ...h, at: Math.max(0, h.at - 1) }));
            if (e.data?.type === "site-preview-ready" && pendingAnchor.current) {
                frame.current?.contentWindow?.postMessage({ type: "site-preview-scroll", anchor: pendingAnchor.current }, "*");
                pendingAnchor.current = null;
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);
    const pendingAnchor = useRef<string | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                site.set({ inlinePreview: false });
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    const page = pages?.find((p) => p.path === current) ?? pages?.find((p) => p.path === "/404") ?? pages?.[0];
    const zoom = scale === "fit" ? Math.min(1, avail.w / width) : Number(scale);
    const active = list.find((b) => width >= b.min && (b.max === null || width <= b.max)) ?? list[0];

    // Dragging either side handle changes the width symmetrically, snapping near breakpoints.
    const drag = (side: -1 | 1) => (e: React.PointerEvent) => {
        e.preventDefault();
        const x0 = e.clientX;
        const w0 = width;
        const move = (ev: PointerEvent) => {
            let w = Math.round(w0 + ((ev.clientX - x0) * side * 2) / zoom);
            w = Math.max(240, Math.min(3840, w));
            const near = list.find((b) => Math.abs(b.width - w) <= SNAP / zoom);
            setWidth(near ? near.width : w);
        };
        setDragging(true);
        const up = () => {
            setDragging(false);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    const btn = "flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-ink outline-none hover:bg-panel-hover disabled:opacity-35";
    return (
        <div role="dialog" aria-label="Inline preview" className="absolute inset-0 z-40 flex flex-col bg-canvas">
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-panel-border bg-panel px-2">
                <button type="button" aria-label="Back" className={btn} disabled={history.at === 0} onClick={() => setHistory((h) => ({ ...h, at: Math.max(0, h.at - 1) }))}>
                    <ArrowLeft className="size-3.5" />
                </button>
                <button type="button" aria-label="Forward" className={btn} disabled={history.at >= history.stack.length - 1} onClick={() => setHistory((h) => ({ ...h, at: Math.min(h.stack.length - 1, h.at + 1) }))}>
                    <ArrowRight className="size-3.5" />
                </button>
                <button type="button" aria-label="Reload" className={btn} onClick={() => frame.current && page && (frame.current.srcdoc = page.html)}>
                    <RefreshCw01 className="size-3.5" />
                </button>
                <select aria-label="Page" value={page?.path ?? current} onChange={(e) => go(e.target.value)} className="h-7 max-w-52 rounded-[6px] bg-field px-2 text-[11px] text-ink outline-none">
                    {(pages ?? []).map((p) => (
                        <option key={p.path} value={p.path}>
                            {p.title} ({p.path})
                        </option>
                    ))}
                </select>
                <div className="mx-auto flex items-center gap-0.5 rounded-[8px] bg-field p-[3px]" role="group" aria-label="Breakpoints">
                    {list.map((b) => (
                        <button key={b.id} type="button" aria-pressed={active?.id === b.id} onClick={() => setWidth(b.width)} className={`h-[22px] rounded-[5px] px-2 text-[11px] font-medium ${active?.id === b.id ? "bg-brand-500 text-white" : "text-ink-muted hover:text-ink"}`}>
                            {b.label}
                        </button>
                    ))}
                </div>
                <label className="flex h-7 items-center gap-1 rounded-[6px] bg-field px-2 text-[11px]">
                    <span className="text-ink-subtle">W</span>
                    <input
                        key={width}
                        type="number"
                        aria-label="Preview width"
                        defaultValue={width}
                        className="w-12 bg-transparent outline-none"
                        onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 240) setWidth(Math.min(3840, Math.round(v)));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                </label>
                <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value)} className="h-7 rounded-[6px] bg-field px-2 text-[11px] text-ink outline-none">
                    {SCALES.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.id === "fit" ? `Fit (${Math.round(zoom * 100)}%)` : s.label}
                        </option>
                    ))}
                </select>
                <button type="button" aria-label="Open in a new tab" title="Open in a new tab (⌥⌘↵)" className={btn} onClick={() => openPreview()}>
                    <LinkExternal01 className="size-3.5" />
                </button>
                <button type="button" aria-label="Close preview" title="Close (Esc)" className={btn} onClick={() => site.set({ inlinePreview: false })}>
                    <XClose className="size-4" />
                </button>
            </div>
            <div ref={stage} className="relative min-h-0 flex-1 overflow-auto">
                {/* Keeps the pointer from the frame while a handle is dragged. */}
                {dragging && <div className="absolute inset-0 z-20 cursor-ew-resize" />}
                <div className="flex min-h-full justify-center py-3">
                    <div className="relative shrink-0" style={{ width: width * zoom, height: Math.max(200, avail.h) }}>
                        <div aria-hidden="true" onPointerDown={drag(-1)} className="absolute top-0 -left-4 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center">
                            <span className="h-10 w-1 rounded-full bg-ink-muted/50" />
                        </div>
                        <div style={{ width, height: Math.max(200, avail.h) / zoom, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
                            {page ? (
                                <iframe ref={frame} title="Site preview" srcDoc={page.html} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals" className="block size-full rounded-[4px] border-0 bg-white shadow-lg" />
                            ) : (
                                <div className="flex size-full items-center justify-center text-ink-muted">Building the preview…</div>
                            )}
                        </div>
                        <div aria-hidden="true" onPointerDown={drag(1)} className="absolute top-0 -right-4 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center">
                            <span className="h-10 w-1 rounded-full bg-ink-muted/50" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

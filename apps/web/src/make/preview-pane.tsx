import { AlertCircle, Stars02 } from "@untitledui/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fileMeta, putServerMeta, setFileThumb } from "../engine/files";
import { legacy } from "../engine/legacy-names";
import { editor, useEditor } from "../engine/store";
import { previewHtml } from "./bundle";
import { previewDataToken, withCurrentBackend } from "./publish";
import { fixError } from "./generate";
import { makeData } from "./model";
import { FRAME_COLORS, make, useMake, type Device } from "./state";
import { CommentPins, DrawLayer } from "./preview-overlays";
import { answered, setPreviewScroll, setPreviewWindow } from "./preview-bridge";
import type { PickedElement } from "./types";

// The live preview: the project bundled in this browser and run in a sandboxed frame (scripts only,
// its own opaque origin), at desktop, tablet or phone size. Point and edit picks elements in it.

// The same widths as a site's Tablet and Mobile breakpoints.
const SIZES: Record<Exclude<Device, "desktop">, { w: number; h: number }> = { tablet: { w: 768, h: 1024 }, mobile: { w: 375, h: 812 } };

// The data token goes in the head, where the app's backend helper looks for it.
function withToken(html: string, token: string): string {
    const safe = token.replace(/[^A-Za-z0-9._-]/g, "");
    // Apps made before the rename look for the token under the old name.
    const meta = `<meta name="nagma-app-token" content="${safe}"><meta name="${legacy.appTokenMeta}" content="${safe}">`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + meta) : meta + html;
}

export function PreviewPane() {
    const files = useEditor((s) => makeData(s.doc).files);
    const appId = useEditor((s) => makeData(s.doc).appId);
    const backend = useEditor((s) => makeData(s.doc).backend);
    const readOnly = useEditor((s) => s.readOnly);
    const reload = useMake((s) => s.reload);
    const device = useMake((s) => s.device);
    const frameColor = useMake((s) => s.frameColor);
    const previewBg = useMake((s) => s.previewBg);
    const picking = useMake((s) => s.picking);
    const error = useMake((s) => s.error);
    const busy = useMake((s) => s.busy !== null);
    const ai = useMake((s) => s.ai);
    const [html, setHtml] = useState<string | null>(null);
    const [buildErrors, setBuildErrors] = useState<string[]>([]);
    const frame = useRef<HTMLIFrameElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const [area, setArea] = useState({ w: 800, h: 600 });
    const empty = Object.keys(files).length === 0;

    // Rebuilt a moment after the files change (typing in Code doesn't rebuild on every key).
    useEffect(() => {
        if (empty) return;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            // A protected app's data needs a token, as its published page gets one.
            const token = backend && appId ? previewDataToken(appId) : Promise.resolve(null);
            void Promise.all([previewHtml(withCurrentBackend(files, appId, backend)), token])
                .then(([out, t]) => {
                    if (cancelled) return;
                    setHtml(t ? withToken(out.html, t) : out.html);
                    setBuildErrors(out.errors);
                    make.set({ error: null });
                })
                .catch((e: unknown) => !cancelled && setBuildErrors([e instanceof Error ? e.message : String(e)]));
        }, 300);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [files, reload, empty, appId, backend]);

    useLayoutEffect(() => {
        const el = box.current;
        if (!el) return;
        const observer = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Messages from the app: ready, errors, the picked element, its picture for Home.
    const captured = useRef<string | null>(null);
    useEffect(() => {
        let captureTimer = 0;
        const onMessage = (e: MessageEvent) => {
            if (!frame.current || e.source !== frame.current.contentWindow) return;
            const d = e.data as { mk?: number; type?: string; message?: string; data?: string; add?: boolean; tree?: unknown; full?: boolean; x?: number; y?: number } & Partial<PickedElement>;
            if (!d?.mk) return;
            setPreviewWindow(frame.current.contentWindow);
            if (d.type === "ready") {
                frame.current.contentWindow?.postMessage({ mk: 1, type: "pick", on: make.get().picking }, "*");
                const picks = make.get().picks;
                if (picks.length) frame.current.contentWindow?.postMessage({ mk: 1, type: "select", srcs: picks.map((p) => p.src) }, "*");
                // Staged changes survive a rebuild of the preview.
                for (const [src, edit] of Object.entries(make.get().staged)) frame.current.contentWindow?.postMessage({ mk: 1, type: "stage", src, style: edit.style, text: edit.text }, "*");
                // A picture of the app for the file's card on Home, once per version of the app.
                const s = editor.get();
                if (!s.readOnly && s.fileId && captured.current !== html) {
                    captured.current = html;
                    window.clearTimeout(captureTimer);
                    captureTimer = window.setTimeout(() => frame.current?.contentWindow?.postMessage({ mk: 1, type: "capture", id: s.fileId }, "*"), 1500);
                }
            }
            if (d.type === "error" && d.message) make.set({ error: d.message });
            if (d.type === "picked" && d.src) {
                const picked: PickedElement = { src: d.src, tag: d.tag ?? "div", text: d.text ?? "", html: d.html ?? "", color: d.color ?? "", background: d.background ?? "", classes: d.classes ?? "", style: d.style ?? {} };
                const picks = d.add ? [...make.get().picks.filter((p) => p.src !== picked.src), picked] : [picked];
                make.set({ picked, picks });
            }
            if (d.type === "scroll") setPreviewScroll(d.x ?? 0, d.y ?? 0);
            if (d.type === "layers") answered("layers", d.tree ?? null);
            if (d.type === "captured" && d.full) answered(`capture:${(d as { id?: string }).id ?? ""}`, d.data ?? null);
            else if (d.type === "captured" && d.data && typeof (d as { id?: string }).id === "string") {
                const id = (d as { id: string }).id;
                setFileThumb(id, d.data);
                const shared = fileMeta(id)?.shared;
                if (shared) void putServerMeta(shared, { thumb: d.data, kind: "make" });
            }
        };
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("message", onMessage);
            window.clearTimeout(captureTimer);
        };
    }, [html]);

    useEffect(() => {
        frame.current?.contentWindow?.postMessage({ mk: 1, type: "pick", on: picking }, "*");
    }, [picking]);
    useEffect(() => {
        const off = make.subscribe(() => {
            if (!make.get().picks.length) frame.current?.contentWindow?.postMessage({ mk: 1, type: "clear" }, "*");
        });
        return () => void off();
    }, []);

    const size = device === "desktop" ? null : SIZES[device];
    const scale = size ? Math.min(1, (area.w - 48) / size.w, (area.h - 48) / size.h) : 1;
    const problem = buildErrors[0] ?? error;

    return (
        <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-canvas" style={previewBg ? { background: previewBg } : undefined}>
            {empty ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-[12px] text-ink-muted">
                    <Stars02 className="size-6 text-ink-subtle" />
                    <div className="text-[13px] font-semibold text-ink">{busy ? "Building your app" : "Your app shows here"}</div>
                    <div className="max-w-80 leading-relaxed">{readOnly ? "Nothing has been made in this file yet." : ai && !ai.available ? "Attach frames from a design file to turn them into an app, or write the code in Files." : "Describe the app you want in the chat, or attach frames from a design file to build from."}</div>
                </div>
            ) : (
                html !== null && (
                    <div className="flex h-full w-full items-center justify-center">
                        <div
                            className={size ? `shrink-0 overflow-hidden bg-white shadow-xl ${frameColor === "none" ? "rounded-[14px] border border-panel-border" : "rounded-[44px]"}` : "h-full w-full bg-white"}
                            style={size ? { width: size.w, height: size.h, transform: `scale(${scale})`, ...(frameColor !== "none" ? { border: `10px solid ${FRAME_COLORS[frameColor]}` } : {}) } : undefined}
                        >
                            <div className="relative h-full w-full">
                                <iframe key={reload} ref={frame} title="App preview" sandbox="allow-scripts" srcDoc={html} onLoad={() => setPreviewWindow(frame.current?.contentWindow ?? null)} className="block h-full w-full border-0 bg-white" />
                                <CommentPins />
                                <DrawLayer />
                            </div>
                        </div>
                    </div>
                )
            )}
            {problem && !empty && (
                <div role="alert" className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-panel p-2.5 text-[11px] shadow-lg">
                    <AlertCircle className="mt-px size-3.5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink">The app has a problem</div>
                        <div className="mt-0.5 line-clamp-3 font-mono break-words whitespace-pre-wrap text-ink-muted">{problem}</div>
                    </div>
                    {!readOnly && ai?.available && (
                        <button type="button" disabled={busy} onClick={() => fixError(problem)} className="h-6 shrink-0 rounded-md bg-brand-500 px-2 font-semibold text-white disabled:opacity-50">
                            Fix with AI
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type CommentInfo, DOC_BLUE, type FieldInfo, type PageInfo, type Rect } from "./model";
import { type DocTool, docView, drawInto, edit, me, styleFor, textLayer, useDoc, workbench } from "./state";
import { type TextLine, glyphAtPoint, paragraphEdit, rangeRects } from "./text";
import { placeSignature } from "./signature";
import { SelectionBar } from "./selection-bar";

// The pages, one under another, at the zoom of the moment. Each page is the engine's picture of
// it, with an interactive layer on top: text selection, search hits, comments to pick and move,
// form fields to fill, and whatever the current tool draws.

export const GAP = 16;
export const PAD = 24;

let scroller: HTMLDivElement | null = null;

export function pageTop(pages: PageInfo[], zoom: number, index: number): number {
    let y = PAD;
    for (let i = 0; i < index && i < pages.length; i++) y += (pages[i]?.height ?? 0) * zoom + GAP;
    return y;
}

// Scrolls so page `index` (and the point `y` on it, in points) is at the top.
export function scrollToPage(index: number, y = 0, smooth = false) {
    const s = docView.get();
    const pages = s.info?.pages ?? [];
    if (!scroller || !pages.length) return;
    const page = Math.max(0, Math.min(pages.length - 1, index));
    scroller.scrollTo({ top: pageTop(pages, s.zoom, page) + y * s.zoom - (y ? 80 : 8), behavior: smooth ? "smooth" : "auto" });
    docView.set({ page });
}

export function viewportSize(): { width: number; height: number } {
    return { width: scroller?.clientWidth ?? 800, height: scroller?.clientHeight ?? 600 };
}

// Zoom that fits the widest page across, or the current page whole.
export function fitZoom(mode: "width" | "page"): number {
    const s = docView.get();
    const pages = s.info?.pages ?? [];
    const { width, height } = viewportSize();
    const widest = Math.max(1, ...pages.map((p) => p.width));
    const cur = pages[s.page] ?? pages[0];
    if (mode === "width") return Math.max(0.1, Math.min(8, (width - PAD * 2 - 12) / widest));
    if (!cur) return 1;
    return Math.max(0.1, Math.min(8, Math.min((width - PAD * 2) / cur.width, (height - PAD * 2) / cur.height)));
}

export function setZoom(zoom: number, keepCenter = true) {
    const s = docView.get();
    const next = Math.max(0.1, Math.min(8, zoom));
    if (!scroller || !keepCenter) return docView.set({ zoom: next, fit: null });
    const ratio = next / s.zoom;
    const cx = scroller.scrollLeft + scroller.clientWidth / 2;
    const cy = scroller.scrollTop + scroller.clientHeight / 2;
    docView.set({ zoom: next, fit: null });
    requestAnimationFrame(() => {
        if (!scroller) return;
        scroller.scrollLeft = cx * ratio - scroller.clientWidth / 2;
        scroller.scrollTop = cy * ratio - scroller.clientHeight / 2;
    });
}

function PageCanvas({ index, zoom, version }: { index: number; zoom: number; version: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const holder = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const drawn = useRef<string>("");
    useEffect(() => {
        const el = holder.current;
        if (!el) return;
        const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { root: scroller, rootMargin: "800px 0px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const canvas = ref.current;
        if (!visible || !canvas) return;
        const scale = Math.min(4, zoom * window.devicePixelRatio);
        const key = `${version}:${scale.toFixed(3)}`;
        if (drawn.current === key) return;
        // Draw after the frame, so scrolling through many pages stays smooth.
        const timer = window.setTimeout(() => {
            try {
                drawInto(index, scale, canvas);
                drawn.current = key;
            } catch {
                // A page the renderer can't draw stays white; the rest still work.
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [visible, zoom, version, index]);
    return (
        <div ref={holder} className="absolute inset-0">
            <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />
        </div>
    );
}

type Drag =
    | { kind: "text"; page: number; anchor: number }
    | { kind: "box"; tool: DocTool; start: [number, number]; end: [number, number] }
    | { kind: "line"; tool: DocTool; start: [number, number]; end: [number, number] }
    | { kind: "ink"; points: [number, number][] }
    | { kind: "move"; comment: CommentInfo; start: [number, number]; end: [number, number] }
    | { kind: "image"; index: number; rect: Rect; start: [number, number]; end: [number, number] }
    | { kind: "pan"; x: number; y: number; left: number; top: number };

const MARKUP: DocTool[] = ["highlight", "underline", "strikeout", "redact"];
const BOX_TOOLS: DocTool[] = ["rect", "oval", "redact", "textbox"];

function norm(a: [number, number], b: [number, number]): Rect {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

// Text typed onto a page (a text box comment, or Fill & Sign text) before it is added.
interface Pending {
    kind: "textbox" | "typewriter";
    rect: Rect;
}

function markupFor(tool: DocTool, page: number, rects: Rect[]) {
    if (!rects.length) return;
    const style = styleFor(tool);
    if (tool === "redact") edit({ op: "annotate", page, kind: "redact", rects, author: me() }, { textSel: null });
    else edit({ op: "annotate", page, kind: tool, rects, author: me(), color: style.color, opacity: style.opacity }, { textSel: null });
}

function FieldInput({ field, widget, zoom }: { field: FieldInfo; widget: FieldInfo["widgets"][number]; zoom: number }) {
    const [x0, y0, x1, y1] = widget.rect;
    const style: React.CSSProperties = { left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom };
    const value = field.value[0] ?? "";
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const cls = "absolute rounded-[2px] border border-transparent bg-(--doc-accent)/10 outline-none hover:border-(--doc-accent) focus:border-(--doc-accent) focus:bg-white";
    const label = field.tooltip || field.name;
    if (field.readOnly || field.kind === "button" || field.kind === "signature") return null;
    if (field.kind === "checkbox" || field.kind === "radio") {
        const on = field.kind === "checkbox" ? Boolean(widget.state && widget.state !== "Off") : value !== "" && value === widget.onState;
        return (
            <button
                type="button"
                role={field.kind}
                aria-checked={on}
                aria-label={label}
                onClick={() => edit({ op: "setField", name: field.name, value: field.kind === "checkbox" ? !on : on ? "" : widget.onState })}
                className={cls}
                style={style}
            />
        );
    }
    if (field.kind === "combo" || field.kind === "list") {
        return (
            <select aria-label={label} value={value} onChange={(e) => edit({ op: "setField", name: field.name, value: e.target.value })} className={`${cls} cursor-pointer text-transparent focus:text-black`} style={{ ...style, fontSize: Math.max(8, (y1 - y0) * zoom * 0.55) }}>
                <option value="" />
                {field.options.map(([v, t]) => (
                    <option key={v} value={v}>
                        {t || v}
                    </option>
                ))}
            </select>
        );
    }
    const commit = () => {
        if (draft !== value) edit({ op: "setField", name: field.name, value: draft });
    };
    const fontSize = Math.max(8, Math.min(14 * zoom, (y1 - y0) * zoom * 0.62));
    const common = {
        "aria-label": label,
        value: draft,
        maxLength: field.maxLen ?? undefined,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
        onBlur: commit,
        className: `${cls} px-1 text-black opacity-0 focus:opacity-100`,
        style: { ...style, fontSize, fontFamily: "Helvetica, Arial, sans-serif" },
    };
    return field.multiline ? <textarea {...common} className={`${common.className} resize-none`} /> : <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function EditLayer({ index, zoom, version }: { index: number; zoom: number; version: number }) {
    const [lines, setLines] = useState<{ text: string; rect: Rect; size: number; font: string; decodable: boolean }[]>([]);
    const [images, setImages] = useState<{ rect: Rect; width: number; height: number; form: boolean }[]>([]);
    const [editing, setEditing] = useState<number | null>(null);
    // A paragraph being edited: the lines it spans.
    const [paragraph, setParagraph] = useState<number[] | null>(null);
    const clickTimer = useRef(0);
    const imageSel = useDoc((s) => s.imageSel);
    useEffect(() => {
        const wb = workbench();
        if (!wb) return;
        try {
            setLines(JSON.parse(wb.textLines(index)));
            setImages(JSON.parse(wb.pageImages(index)));
        } catch {
            setLines([]);
            setImages([]);
        }
    }, [index, version]);
    return (
        <>
            {images.map((img, i) => {
                const [x0, y0, x1, y1] = img.rect;
                const picked = imageSel?.page === index && imageSel.index === i;
                return (
                    <div
                        key={`img${i}`}
                        data-image={i}
                        title={img.form ? "Artwork" : `Image ${img.width} × ${img.height}`}
                        className={`absolute cursor-move border ${picked ? "border-2 border-(--doc-accent)" : "border-dashed border-(--doc-accent)/60 hover:border-(--doc-accent)"}`}
                        style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }}
                    />
                );
            })}
            {paragraph && <ParagraphEditor lines={lines} picked={paragraph} index={index} zoom={zoom} onDone={() => setParagraph(null)} />}
            {lines.map((line, i) => {
                if (paragraph?.includes(i)) return null;
                const [x0, y0, x1, y1] = line.rect;
                const box = { left: x0 * zoom - 2, top: y0 * zoom - 2, width: Math.max(20, (x1 - x0) * zoom + 4), height: (y1 - y0) * zoom + 4 };
                if (editing === i) {
                    return (
                        <input
                            key={`line${i}`}
                            autoFocus
                            aria-label="Edit text"
                            defaultValue={line.text}
                            onFocus={(e) => e.target.select()}
                            onBlur={(e) => {
                                setEditing(null);
                                if (e.target.value !== line.text) edit({ op: "editTextLine", page: index, line: i, text: e.target.value });
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditing(null);
                                e.stopPropagation();
                            }}
                            className="absolute z-10 rounded-[2px] border border-(--doc-accent) bg-white px-0.5 text-black outline-none"
                            style={{ ...box, width: Math.max(box.width + 40, 120), fontSize: Math.max(8, line.size * zoom), lineHeight: 1, fontFamily: "Helvetica, Arial, sans-serif" }}
                        />
                    );
                }
                return (
                    <button
                        key={`line${i}`}
                        type="button"
                        aria-label={`Edit text: ${line.text}`}
                        title={`${line.decodable ? line.font : `${line.font} (new text uses a standard font)`}. Click to edit the line, double-click to edit the paragraph.`}
                        onMouseDown={(e) => e.stopPropagation()}
                        // A click edits the line, a double click the paragraph (the click waits a moment
                        // to see which it is).
                        onClick={(e) => {
                            window.clearTimeout(clickTimer.current);
                            if (e.detail === 1) clickTimer.current = window.setTimeout(() => setEditing(i), 230);
                        }}
                        onDoubleClick={() => {
                            window.clearTimeout(clickTimer.current);
                            setEditing(null);
                            setParagraph(paragraphOf(lines, i));
                        }}
                        className="absolute cursor-text rounded-[2px] border border-dashed border-(--doc-accent)/50 hover:border-solid hover:border-(--doc-accent) hover:bg-(--doc-accent)/5"
                        style={box}
                    />
                );
            })}
        </>
    );
}

// The lines that make one paragraph with line `i`: neighbours above and below of the same size,
// starting near the same left edge, with no more than a line's gap between them.
function paragraphOf(lines: TextLine[], i: number): number[] {
    const at = lines[i];
    if (!at) return [i];
    const fits = (a: TextLine, b: TextLine) => Math.abs(a.size - b.size) < 0.6 && Math.abs(a.rect[0] - b.rect[0]) < a.size * 2.5 && b.rect[1] - a.rect[3] < a.size * 0.9 && b.rect[1] > a.rect[1];
    const out = [i];
    for (let k = i; k > 0; k--) {
        const above = lines[k - 1];
        const cur = lines[k];
        if (!above || !cur || !fits(above, cur)) break;
        out.unshift(k - 1);
    }
    for (let k = i; k < lines.length - 1; k++) {
        const cur = lines[k];
        const below = lines[k + 1];
        if (!cur || !below || !fits(cur, below)) break;
        out.push(k + 1);
    }
    return out;
}

// Editing a whole paragraph: its lines' text as one, wrapped again to the paragraph's width when
// it's saved. Lines left over are emptied; more lines than before go below it in the same size.
function ParagraphEditor({ lines, picked, index, zoom, onDone }: { lines: TextLine[]; picked: number[]; index: number; zoom: number; onDone: () => void }) {
    const pageWidth = useDoc((s) => s.info?.pages[index]?.width ?? 612);
    const parts = picked.map((i) => lines[i]).filter((l): l is TextLine => Boolean(l));
    const first = parts[0];
    if (!first) return null;
    const left = Math.min(...parts.map((l) => l.rect[0]));
    const top = Math.min(...parts.map((l) => l.rect[1]));
    // Within the page, keeping the left margin on the right too.
    const right = Math.min(Math.max(...parts.map((l) => l.rect[2])), pageWidth - left);
    const bottom = Math.max(...parts.map((l) => l.rect[3]));
    const original = parts.map((l) => l.text).join(" ");
    const commit = (text: string) => {
        onDone();
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) ctx.font = `${first.size}px Helvetica, Arial, sans-serif`;
        const op = paragraphEdit(lines, picked, index, text, right, (s) => ctx?.measureText(s).width ?? s.length * first.size * 0.5);
        if (op) edit(op);
    };
    return (
        <textarea
            autoFocus
            aria-label="Edit paragraph"
            defaultValue={original}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") onDone();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            className="absolute z-10 resize-none rounded-[2px] border border-(--doc-accent) bg-white px-0.5 text-black outline-none"
            style={{ left: left * zoom - 2, top: top * zoom - 2, width: Math.max(160, (right - left) * zoom + 4), minHeight: (bottom - top) * zoom + 8, fontSize: Math.max(8, first.size * zoom), lineHeight: 1.2, fontFamily: "Helvetica, Arial, sans-serif" }}
        />
    );
}

function PageLayer({ index, zoom }: { index: number; zoom: number }) {
    const tool = useDoc((s) => s.tool);
    const version = useDoc((s) => s.version);
    const info = useDoc((s) => s.info);
    const selected = useDoc((s) => s.selected);
    const hits = useDoc((s) => s.hits);
    const hit = useDoc((s) => s.hit);
    const textSel = useDoc((s) => s.textSel);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const comments = (info?.comments ?? []).filter((c) => c.page === index && !c.inReplyTo && c.subtype !== "Popup");
    const fields = (info?.fields ?? []).flatMap((f) => f.widgets.filter((w) => w.page === index && !w.hidden).map((w) => ({ field: f, widget: w })));
    const showFields = tool === "select" || tool === "fill" || tool === "hand";
    const at = (e: { clientX: number; clientY: number }): [number, number] => {
        const r = layerRef.current?.getBoundingClientRect();
        if (!r) return [0, 0];
        return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
    };
    const hitComment = (p: [number, number]) =>
        [...comments].reverse().find((c) => {
            const pad = 3;
            const boxes = c.quads.length ? c.quads : [c.rect];
            return boxes.some(([x0, y0, x1, y1]) => p[0] >= x0 - pad && p[0] <= x1 + pad && p[1] >= y0 - pad && p[1] <= y1 + pad);
        });

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0 || pending) return;
        const p = at(e);
        docView.set({ page: index });
        const target = e.target as HTMLElement;
        if (tool === "hand" || (e.button === 0 && (e.nativeEvent as PointerEvent).pointerType === "mouse" && keysDown.space)) {
            if (scroller) setDrag({ kind: "pan", x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop });
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            return;
        }
        if (tool === "edit") {
            const img = target.dataset.image;
            if (img !== undefined) {
                const i = Number(img);
                const el = target.getBoundingClientRect();
                const r = layerRef.current?.getBoundingClientRect();
                const rect: Rect = r ? [(el.left - r.left) / zoom, (el.top - r.top) / zoom, (el.right - r.left) / zoom, (el.bottom - r.top) / zoom] : [0, 0, 0, 0];
                docView.set({ imageSel: { page: index, index: i } });
                setDrag({ kind: "image", index: i, rect, start: p, end: p });
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } else docView.set({ imageSel: null });
            return;
        }
        if (tool === "select") {
            const c = hitComment(p);
            if (c) {
                docView.set({ selected: { page: c.page, index: c.index }, textSel: null });
                if (!c.locked) setDrag({ kind: "move", comment: c, start: p, end: p });
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }
        }
        if (tool === "select" || MARKUP.includes(tool)) {
            const layer = textLayer(index);
            const g = layer ? glyphAtPoint(layer, p[0], p[1], tool === "select" ? 4 : 10) : null;
            if (g !== null) {
                docView.set({ textSel: { page: index, from: g, to: g }, selected: null });
                setDrag({ kind: "text", page: index, anchor: g });
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }
            if (tool === "select") {
                docView.set({ selected: null, textSel: null });
                return;
            }
        }
        const style = styleFor(tool);
        switch (tool) {
            case "note":
                if (edit({ op: "annotate", page: index, kind: "note", at: [p[0] - 10, p[1] - 10], author: me(), color: style.color, contents: "" })) {
                    const made = docView.get().info?.comments.filter((c) => c.page === index && c.subtype === "Text" && !c.inReplyTo).pop();
                    docView.set({ tool: "select", selected: made ? { page: index, index: made.index } : null });
                }
                return;
            case "stamp": {
                const w = 150;
                const h = 46;
                edit({ op: "annotate", page: index, kind: "stamp", stamp: docView.get().stamp, rect: [p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2], author: me() }, { tool: "select" });
                return;
            }
            case "check":
            case "cross": {
                const s = 12;
                edit({ op: "annotate", page: index, kind: tool, rect: [p[0] - s / 2, p[1] - s / 2, p[0] + s / 2, p[1] + s / 2], author: me() });
                return;
            }
            case "fill":
                setPending({ kind: "typewriter", rect: [p[0], p[1] - 9, p[0] + 220, p[1] + 9] });
                return;
            case "sign":
                placeSignature(index, p);
                return;
            case "draw":
                setDrag({ kind: "ink", points: [p] });
                break;
            case "line":
            case "arrow":
                setDrag({ kind: "line", tool, start: p, end: p });
                break;
            default:
                if (BOX_TOOLS.includes(tool)) setDrag({ kind: "box", tool, start: p, end: p });
        }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag) return;
        const p = at(e);
        if (drag.kind === "pan") {
            if (scroller) {
                scroller.scrollLeft = drag.left - (e.clientX - drag.x);
                scroller.scrollTop = drag.top - (e.clientY - drag.y);
            }
            return;
        }
        if (drag.kind === "text") {
            const layer = textLayer(index);
            const g = layer ? glyphAtPoint(layer, p[0], p[1], 40) : null;
            if (g !== null) docView.set({ textSel: { page: index, from: drag.anchor, to: g } });
            return;
        }
        if (drag.kind === "ink") return setDrag({ ...drag, points: [...drag.points, p] });
        setDrag({ ...drag, end: p });
    };

    const onPointerUp = () => {
        const d = drag;
        setDrag(null);
        if (!d) return;
        const style = styleFor(tool);
        if (d.kind === "text") {
            const sel = docView.get().textSel;
            if (sel && MARKUP.includes(tool)) {
                const layer = textLayer(index);
                if (layer) markupFor(tool, index, rangeRects(layer, sel.from, sel.to));
            }
            return;
        }
        if (d.kind === "move") {
            const [dx, dy] = [d.end[0] - d.start[0], d.end[1] - d.start[1]];
            if (Math.hypot(dx, dy) > 1) edit({ op: "moveAnnotation", page: index, index: d.comment.index, dx, dy });
            return;
        }
        if (d.kind === "image") {
            const [dx, dy] = [d.end[0] - d.start[0], d.end[1] - d.start[1]];
            if (Math.hypot(dx, dy) > 1) {
                const [x0, y0, x1, y1] = d.rect;
                edit({ op: "editImage", page: index, index: d.index, rect: [x0 + dx, y0 + dy, x1 + dx, y1 + dy] }, { imageSel: { page: index, index: d.index } });
            }
            return;
        }
        if (d.kind === "ink") {
            if (d.points.length > 1) edit({ op: "annotate", page: index, kind: "ink", strokes: [d.points], author: me(), color: style.color, opacity: style.opacity, width: style.width });
            return;
        }
        if (d.kind === "line") {
            if (Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) > 3) edit({ op: "annotate", page: index, kind: d.tool, from: d.start, to: d.end, author: me(), color: style.color, opacity: style.opacity, width: style.width });
            return;
        }
        if (d.kind === "box") {
            let r = norm(d.start, d.end);
            const small = r[2] - r[0] < 4 || r[3] - r[1] < 4;
            if (d.tool === "textbox") {
                if (small) r = [r[0], r[1], r[0] + 200, r[1] + 40];
                setPending({ kind: "textbox", rect: r });
                return;
            }
            if (small) return;
            if (d.tool === "redact") edit({ op: "annotate", page: index, kind: "redact", rect: r, author: me() });
            else edit({ op: "annotate", page: index, kind: d.tool === "oval" ? "oval" : "rect", rect: r, author: me(), color: style.color, opacity: style.opacity, width: style.width });
        }
    };

    const commitPending = (value: string) => {
        const p = pending;
        setPending(null);
        if (!p || !value.trim()) return;
        const style = styleFor(p.kind === "textbox" ? "textbox" : "fill");
        const lines = value.split("\n").length;
        const r: Rect = p.kind === "typewriter" ? [p.rect[0], p.rect[1], p.rect[0] + Math.max(40, value.length * style.fontSize * 0.55 + 8), p.rect[1] + lines * style.fontSize * 1.25 + 4] : p.rect;
        edit({ op: "annotate", page: index, kind: p.kind, rect: r, contents: value, fontSize: style.fontSize, author: me(), color: style.color, ...(p.kind === "textbox" ? { width: 1 } : {}) });
    };

    const layer = textSel?.page === index ? textLayer(index) : null;
    const selRects = layer && textSel ? rangeRects(layer, textSel.from, textSel.to) : [];
    const pageHits = hits.map((h, i) => ({ h, i })).filter(({ h }) => h.page === index);
    const cursor = tool === "hand" ? (drag?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "edit" ? "default" : MARKUP.includes(tool) ? "text" : "crosshair";
    const sel = selected?.page === index ? comments.find((c) => c.index === selected.index) : undefined;
    const preview = drag && (drag.kind === "box" || drag.kind === "line") ? drag : null;
    const moveBy = drag?.kind === "move" ? [drag.end[0] - drag.start[0], drag.end[1] - drag.start[1]] : [0, 0];
    const imgBy = drag?.kind === "image" ? [drag.end[0] - drag.start[0], drag.end[1] - drag.start[1]] : null;

    return (
        <div ref={layerRef} className="absolute inset-0 touch-none select-none" style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
            {pageHits.map(({ h, i }) =>
                h.rects.map((r, k) => (
                    <div key={`${i}-${k}`} className="pointer-events-none absolute rounded-[1px]" style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom, background: i === hit ? "rgba(255,140,0,0.55)" : "rgba(255,213,0,0.4)" }} />
                )),
            )}
            {selRects.map((r, k) => (
                <div key={`s${k}`} data-text-selection="" className="pointer-events-none absolute" style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom, background: "rgba(47,111,237,0.3)" }} />
            ))}
            {tool === "select" && !drag && selRects.length > 0 && <SelectionBar page={index} rects={selRects} zoom={zoom} />}
            {tool === "select" &&
                comments.map((c) => {
                    const isSel = sel?.index === c.index;
                    const [x0, y0, x1, y1] = c.rect;
                    const dx = isSel ? moveBy[0] ?? 0 : 0;
                    const dy = isSel ? moveBy[1] ?? 0 : 0;
                    return (
                        <div
                            key={`c${c.index}`}
                            data-comment={c.index}
                            className={`pointer-events-none absolute rounded-[2px] ${isSel ? "border-2" : "border border-transparent"}`}
                            style={{ left: (x0 + dx) * zoom - 2, top: (y0 + dy) * zoom - 2, width: (x1 - x0) * zoom + 4, height: (y1 - y0) * zoom + 4, borderColor: isSel ? DOC_BLUE : undefined }}
                        />
                    );
                })}
            {tool === "edit" && <EditLayer index={index} zoom={zoom} version={version} />}
            {imgBy && drag?.kind === "image" && (
                <div className="pointer-events-none absolute border-2 border-(--doc-accent) bg-(--doc-accent)/10" style={{ left: (drag.rect[0] + (imgBy[0] ?? 0)) * zoom, top: (drag.rect[1] + (imgBy[1] ?? 0)) * zoom, width: (drag.rect[2] - drag.rect[0]) * zoom, height: (drag.rect[3] - drag.rect[1]) * zoom }} />
            )}
            {showFields && fields.map(({ field, widget }, k) => <FieldInput key={`${field.name}-${k}`} field={field} widget={widget} zoom={zoom} />)}
            {preview && (
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
                    {preview.kind === "box" ? (
                        preview.tool === "oval" ? (
                            (() => {
                                const r = norm(preview.start, preview.end);
                                return <ellipse cx={((r[0] + r[2]) / 2) * zoom} cy={((r[1] + r[3]) / 2) * zoom} rx={((r[2] - r[0]) / 2) * zoom} ry={((r[3] - r[1]) / 2) * zoom} fill="none" style={{ stroke: DOC_BLUE }} strokeWidth={1.5} />;
                            })()
                        ) : (
                            (() => {
                                const r = norm(preview.start, preview.end);
                                return <rect x={r[0] * zoom} y={r[1] * zoom} width={(r[2] - r[0]) * zoom} height={(r[3] - r[1]) * zoom} fill={preview.tool === "redact" ? "rgba(0,0,0,0.35)" : "none"} style={{ stroke: preview.tool === "redact" ? "#E5484D" : DOC_BLUE }} strokeWidth={1.5} strokeDasharray={preview.tool === "textbox" ? "4 3" : undefined} />;
                            })()
                        )
                    ) : (
                        <line x1={preview.start[0] * zoom} y1={preview.start[1] * zoom} x2={preview.end[0] * zoom} y2={preview.end[1] * zoom} style={{ stroke: DOC_BLUE }} strokeWidth={1.5} />
                    )}
                </svg>
            )}
            {drag?.kind === "ink" && (
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
                    <polyline points={drag.points.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")} fill="none" stroke="rgb(51,115,242)" strokeWidth={Math.max(1, styleFor("draw").width * zoom)} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )}
            {pending && (
                <textarea
                    autoFocus
                    aria-label={pending.kind === "textbox" ? "Text box text" : "Text to add"}
                    placeholder="Type here"
                    onBlur={(e) => commitPending(e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") setPending(null);
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || pending.kind === "typewriter")) {
                            e.preventDefault();
                            (e.target as HTMLTextAreaElement).blur();
                        }
                    }}
                    className="absolute z-10 resize-none rounded-[2px] border border-(--doc-accent) bg-white/90 px-1 text-black outline-none"
                    style={{
                        left: pending.rect[0] * zoom,
                        top: pending.rect[1] * zoom,
                        width: (pending.rect[2] - pending.rect[0]) * zoom,
                        height: Math.max((pending.rect[3] - pending.rect[1]) * zoom, 22),
                        fontSize: styleFor(pending.kind === "textbox" ? "textbox" : "fill").fontSize * zoom,
                        lineHeight: 1.2,
                        fontFamily: "Helvetica, Arial, sans-serif",
                    }}
                />
            )}
        </div>
    );
}

export const keysDown = { space: false };

export function PageStack() {
    const info = useDoc((s) => s.info);
    const zoom = useDoc((s) => s.zoom);
    const fit = useDoc((s) => s.fit);
    const version = useDoc((s) => s.version);
    const ref = useRef<HTMLDivElement>(null);
    const pages = info?.pages ?? [];

    useLayoutEffect(() => {
        scroller = ref.current;
        return () => {
            if (scroller === ref.current) scroller = null;
        };
    }, []);

    // Fit modes follow the window's size.
    useEffect(() => {
        const el = ref.current;
        if (!el || !fit) return;
        const apply = () => {
            const z = fitZoom(fit);
            if (Math.abs(z - docView.get().zoom) > 0.001) docView.set({ zoom: z });
        };
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(el);
        return () => observer.disconnect();
    }, [fit, pages.length]);

    // The page in view.
    const onScroll = () => {
        const el = ref.current;
        if (!el || !pages.length) return;
        const mid = el.scrollTop + el.clientHeight * 0.35;
        let y = PAD;
        let current = 0;
        for (let i = 0; i < pages.length; i++) {
            const h = (pages[i]?.height ?? 0) * zoom;
            if (mid >= y - GAP) current = i;
            y += h + GAP;
        }
        if (current !== docView.get().page) docView.set({ page: current });
    };

    // Ctrl/⌘ + wheel or a pinch zooms.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom(docView.get().zoom * Math.exp(-e.deltaY * 0.01));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    const widest = Math.max(0, ...pages.map((p) => p.width)) * zoom;
    return (
        <div ref={ref} aria-label="Pages" onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-canvas" data-doc-scroller="">
            <div className="relative mx-auto flex flex-col items-center" style={{ paddingTop: PAD, paddingBottom: PAD * 4, gap: GAP, minWidth: widest + PAD * 2 }}>
                {pages.map((p, i) => (
                    <div key={i} role="region" aria-label={`Page ${p.label || i + 1}`} data-page={i} className="relative shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]" style={{ width: p.width * zoom, height: p.height * zoom }}>
                        <PageCanvas index={i} zoom={zoom} version={version} />
                        <PageLayer index={i} zoom={zoom} />
                    </div>
                ))}
            </div>
        </div>
    );
}

// Keeps the space bar's temporary hand tool.
export function useSpacePan() {
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) keysDown.space = true;
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === "Space") keysDown.space = false;
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, []);
}

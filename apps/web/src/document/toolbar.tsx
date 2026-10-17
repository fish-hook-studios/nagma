import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Circle, Cursor01, Download01, FlipBackward, FlipForward, Hand, LayoutGrid01, Lock01, Minus, Pencil01, SearchLg, Square, X, ZoomIn, ZoomOut } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { MenuRow } from "../components/left-sidebar";
import { editor, useEditor } from "../engine/store";
import { addImageToPage, compressDocument, exportImages, exportText, insertFiles, printDocument, replacePageImage } from "./actions";
import { CompressIcon, EditContentIcon, FillSignIcon, HighlightIcon, NoteIcon, RedactIcon, ShapesIcon, SignIcon, StampIcon, TextBoxIcon } from "./icons";
import { DOC_BLUE, STAMPS, SWATCHES, toHex, fromHex } from "./model";
import { fitZoom, scrollToPage, setZoom } from "./page-view";
import { rememberedSignature } from "./signature";
import { type DocTool, docView, downloadPdf, edit, redo, runSearch, saveNow, setTool, setToolStyle, styleFor, undo, useDoc } from "./state";
import { askText } from "../components/ask-text";

// The bar across the top of the pages: undo, the tools (select and hand, comments and markup,
// drawing, shapes, text, stamps, Fill & Sign, editing content, redaction) and All tools; under it
// the options of the tool in hand. The page and zoom controls float at the bottom.

const MENU = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

function ToolButton({ label, shortcut, active, onPress, children, disabled }: { label: string; shortcut?: string; active?: boolean; onPress: () => void; children: React.ReactNode; disabled?: boolean }) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={shortcut ? `${label} (${shortcut})` : label}
            disabled={disabled}
            onClick={onPress}
            className={`flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-[12px] outline-none transition-colors disabled:opacity-35 ${active ? "text-white" : "text-ink hover:bg-panel-hover"}`}
            style={active ? { background: DOC_BLUE } : undefined}
        >
            {children}
        </button>
    );
}

function Sep() {
    return <div className="mx-1 h-5 w-px shrink-0 bg-panel-border" />;
}

const MARKUPS: { tool: DocTool; label: string; shortcut: string }[] = [
    { tool: "highlight", label: "Highlight text", shortcut: "U" },
    { tool: "underline", label: "Underline text", shortcut: "⇧U" },
    { tool: "strikeout", label: "Strike through text", shortcut: "⇧S" },
];
const SHAPES: { tool: DocTool; label: string; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
    { tool: "rect", label: "Rectangle", icon: Square },
    { tool: "oval", label: "Ellipse", icon: Circle },
    { tool: "line", label: "Line", icon: Minus },
    { tool: "arrow", label: "Arrow", icon: ArrowUpRight },
];

function MarkupGlyph({ tool }: { tool: DocTool }) {
    if (tool === "underline") return <span className="text-[13px] font-semibold underline decoration-2 underline-offset-2">U</span>;
    if (tool === "strikeout") return <span className="text-[13px] font-semibold line-through decoration-2">S</span>;
    return <HighlightIcon className="size-4" />;
}

function SplitTool({ label, active, onPress, menuLabel, children, menu }: { label: string; active: boolean; onPress: () => void; menuLabel: string; children: React.ReactNode; menu: React.ReactNode }) {
    return (
        <div className={`flex items-center rounded-md ${active ? "text-white" : ""}`} style={active ? { background: DOC_BLUE } : undefined}>
            <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onPress} className={`flex h-8 min-w-8 items-center justify-center rounded-l-md px-1.5 outline-none ${active ? "" : "text-ink hover:bg-panel-hover"}`}>
                {children}
            </button>
            <AriaMenuTrigger>
                <AriaButton aria-label={menuLabel} className={`flex h-8 w-4 items-center justify-center rounded-r-md outline-none ${active ? "" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom start" offset={4} className={MENU}>
                    {menu}
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

export function DocToolbar() {
    const tool = useDoc((s) => s.tool);
    const view = useDoc((s) => s.view);
    const info = useDoc((s) => s.info);
    const saving = useDoc((s) => s.saving);
    const readOnly = useEditor((s) => s.readOnly);
    const [markup, setMarkup] = useState<DocTool>("highlight");
    const [shape, setShape] = useState<DocTool>("rect");
    useEffect(() => {
        if (MARKUPS.some((m) => m.tool === tool)) setMarkup(tool);
        if (SHAPES.some((m) => m.tool === tool)) setShape(tool);
    }, [tool]);
    const shapeIcon = SHAPES.find((s) => s.tool === shape) ?? SHAPES[0];
    const ShapeIcon = shapeIcon?.icon ?? Square;
    const pick = (t: DocTool) => {
        if (view === "organize") docView.set({ view: "read" });
        setTool(tool === t && t !== "select" ? "select" : t);
    };
    const canAnnotate = !readOnly && (info?.allows.annotate ?? true);
    const canModify = !readOnly && (info?.allows.modify ?? true);
    const all = (key: string) => {
        if (key === "organize") return docView.set({ view: view === "organize" ? "read" : "organize", tool: "select" });
        if (key === "insert") return void insertFiles();
        if (key === "split") return docView.set({ dialog: "split" });
        if (key === "protect") return docView.set({ dialog: "protect" });
        // Pictures are recompressed and the undo history starts over, so it asks first (it ran
        // straight away, with nothing to undo it).
        if (key === "compress") {
            if (window.confirm("Reduce the file size? Pictures are recompressed at a lower quality, and this can't be undone.")) void compressDocument();
            return;
        }
        if (key === "images") return void exportImages();
        if (key === "text") return exportText();
        if (key === "pdf") return downloadPdf();
        if (key === "print") return void printDocument();
        if (key === "flatten") {
            if (window.confirm("Flatten comments and form fields into the pages? They can't be edited afterwards (Undo still works).")) edit({ op: "flatten", comments: true, fields: true });
            return;
        }
        if (key === "sanitize") {
            if (window.confirm("Remove hidden information (metadata, scripts, attachments, hidden layers and more) from this PDF?")) edit({ op: "sanitize" });
            return;
        }
        if (key === "properties") return docView.set({ selected: null, tool: "select" });
    };
    return (
        <div role="toolbar" aria-label="Document tools" className="flex min-h-11 shrink-0 flex-wrap items-center gap-0.5 border-b border-panel-border bg-panel px-2 py-1.5 text-ink">
            <ToolButton label="Undo" shortcut="⌘Z" onPress={undo} disabled={readOnly || !info?.undo}>
                <FlipBackward className="size-4" />
            </ToolButton>
            <ToolButton label="Redo" shortcut="⇧⌘Z" onPress={redo} disabled={readOnly || !info?.redo}>
                <FlipForward className="size-4" />
            </ToolButton>
            <Sep />
            <ToolButton label="Select" shortcut="V" active={tool === "select" && view === "read"} onPress={() => pick("select")}>
                <Cursor01 className="size-4" />
            </ToolButton>
            <ToolButton label="Hand" shortcut="H" active={tool === "hand"} onPress={() => pick("hand")}>
                <Hand className="size-4" />
            </ToolButton>
            <Sep />
            <ToolButton label="Add a comment" shortcut="C" active={tool === "note"} onPress={() => pick("note")} disabled={!canAnnotate}>
                <NoteIcon className="size-4" />
            </ToolButton>
            <SplitTool
                label={MARKUPS.find((m) => m.tool === markup)?.label ?? "Highlight text"}
                active={MARKUPS.some((m) => m.tool === tool)}
                onPress={() => canAnnotate && pick(markup)}
                menuLabel="Text markup tools"
                menu={
                    <AriaMenu aria-label="Text markup" className="outline-none" onAction={(k) => pick(String(k) as DocTool)}>
                        {MARKUPS.map((m) => (
                            <MenuRow key={m.tool} id={m.tool} label={m.label} shortcut={m.shortcut} />
                        ))}
                    </AriaMenu>
                }
            >
                <MarkupGlyph tool={markup} />
            </SplitTool>
            <ToolButton label="Draw" shortcut="D" active={tool === "draw"} onPress={() => pick("draw")} disabled={!canAnnotate}>
                <Pencil01 className="size-4" />
            </ToolButton>
            <SplitTool
                label={shapeIcon?.label ?? "Rectangle"}
                active={SHAPES.some((m) => m.tool === tool)}
                onPress={() => canAnnotate && pick(shape)}
                menuLabel="Shapes"
                menu={
                    <AriaMenu aria-label="Shapes" className="outline-none" onAction={(k) => pick(String(k) as DocTool)}>
                        {SHAPES.map((m) => (
                            <MenuRow key={m.tool} id={m.tool} label={m.label} icon={m.icon} />
                        ))}
                    </AriaMenu>
                }
            >
                {shape ? <ShapeIcon className="size-4" /> : <ShapesIcon className="size-4" />}
            </SplitTool>
            <ToolButton label="Text box" shortcut="T" active={tool === "textbox"} onPress={() => pick("textbox")} disabled={!canAnnotate}>
                <TextBoxIcon className="size-4" />
            </ToolButton>
            <SplitTool
                label={`Stamp: ${STAMPS.find((s) => s.id === docView.get().stamp)?.label ?? "Approved"}`}
                active={tool === "stamp"}
                onPress={() => canAnnotate && pick("stamp")}
                menuLabel="Choose a stamp"
                menu={
                    <AriaMenu
                        aria-label="Stamps"
                        className="max-h-80 overflow-y-auto outline-none"
                        onAction={(k) => {
                            docView.set({ stamp: String(k) });
                            pick("stamp");
                        }}
                    >
                        {STAMPS.map((s) => (
                            <MenuRow key={s.id} id={s.id} label={s.label} />
                        ))}
                    </AriaMenu>
                }
            >
                <StampIcon className="size-4" />
            </SplitTool>
            <Sep />
            <SplitTool
                label="Fill & Sign: add text"
                active={tool === "fill" || tool === "check" || tool === "cross" || tool === "sign"}
                onPress={() => !readOnly && pick("fill")}
                menuLabel="Fill & Sign"
                menu={
                    <AriaMenu
                        aria-label="Fill & Sign"
                        className="outline-none"
                        onAction={(k) => {
                            const key = String(k);
                            if (key === "new-signature") return docView.set({ dialog: "signature" });
                            pick(key as DocTool);
                        }}
                    >
                        <MenuRow id="fill" label="Add text" />
                        <MenuRow id="check" label="Check mark" />
                        <MenuRow id="cross" label="Cross mark" />
                        <AriaSeparator className="my-1 h-px bg-white/15" />
                        <MenuRow id="sign" label={rememberedSignature() ? "Place my signature" : "Sign"} />
                        <MenuRow id="new-signature" label="New signature…" />
                    </AriaMenu>
                }
            >
                <FillSignIcon className="size-4" />
            </SplitTool>
            <ToolButton label="Sign" shortcut="S" active={tool === "sign"} onPress={() => (rememberedSignature() || docView.get().signature ? pick("sign") : docView.set({ dialog: "signature" }))} disabled={readOnly}>
                <SignIcon className="size-4" />
            </ToolButton>
            <ToolButton label="Edit text and images" shortcut="E" active={tool === "edit"} onPress={() => pick("edit")} disabled={!canModify}>
                <EditContentIcon className="size-4" />
            </ToolButton>
            <ToolButton label="Organize pages" active={view === "organize"} onPress={() => all("organize")}>
                <LayoutGrid01 className="size-4" />
            </ToolButton>
            <ToolButton label="Redact" shortcut="R" active={tool === "redact"} onPress={() => pick("redact")} disabled={!canModify}>
                <RedactIcon className="size-4" />
            </ToolButton>
            <ToolButton label="Protect with a password" onPress={() => all("protect")} disabled={readOnly}>
                <Lock01 className="size-4" />
            </ToolButton>
            <ToolButton label="Reduce file size" onPress={() => all("compress")} disabled={!canModify}>
                <CompressIcon className="size-4" />
            </ToolButton>
            <Sep />
            <AriaMenuTrigger>
                <AriaButton className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-ink outline-none hover:bg-panel-hover">
                    All tools <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom start" offset={4} className={MENU}>
                    <AriaMenu aria-label="All tools" className="outline-none" onAction={(k) => all(String(k))}>
                        <MenuRow id="organize" label="Organize pages" />
                        <MenuRow id="insert" label="Insert pages from a file…" />
                        <MenuRow id="split" label="Split into files…" />
                        <AriaSeparator className="my-1 h-px bg-white/15" />
                        <MenuRow id="protect" label="Protect with a password…" />
                        <MenuRow id="compress" label="Reduce file size" />
                        <MenuRow id="flatten" label="Flatten comments and fields" />
                        <MenuRow id="sanitize" label="Remove hidden information" />
                        <AriaSeparator className="my-1 h-px bg-white/15" />
                        <MenuRow id="pdf" label="Download PDF" />
                        <MenuRow id="images" label="Export pages as PNG images" />
                        <MenuRow id="text" label="Export as plain text" />
                        <MenuRow id="print" label="Print…" shortcut="⌘P" />
                        <AriaSeparator className="my-1 h-px bg-white/15" />
                        <MenuRow id="properties" label="Document properties" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <div className="flex-1" />
            <span className="mr-1 whitespace-nowrap text-[11px] text-ink-subtle" aria-live="polite">
                {readOnly ? "View only" : saving === "saving" ? "Saving…" : saving === "unsaved" ? "Edited" : saving === "failed" ? "Not saved" : "Saved"}
            </span>
            <ToolButton label="Find in document" shortcut="⌘F" onPress={() => docView.set({ searchOpen: true })}>
                <SearchLg className="size-4" />
            </ToolButton>
            <ToolButton
                label="Download PDF"
                onPress={async () => {
                    if (docView.get().saving !== "saved" && !readOnly) await saveNow();
                    downloadPdf();
                }}
            >
                <Download01 className="size-4" />
            </ToolButton>
        </div>
    );
}

function Swatches({ tool }: { tool: string }) {
    const style = styleFor(tool);
    useDoc((s) => s.styles);
    const hex = toHex(style.color);
    return (
        <div className="flex items-center gap-1">
            {SWATCHES.map((c) => (
                <button key={c.join()} type="button" aria-label={`Colour ${toHex(c)}`} onClick={() => setToolStyle(tool, { color: c })} className={`size-4 rounded-full border border-black/25 ${toHex(c) === hex ? "ring-2 ring-offset-1 ring-offset-panel" : ""}`} style={{ background: toHex(c), ...(toHex(c) === hex ? { boxShadow: `0 0 0 2px ${DOC_BLUE}` } : {}) }} />
            ))}
            <input type="color" aria-label="Custom colour" value={hex} onChange={(e) => setToolStyle(tool, { color: fromHex(e.target.value) })} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
        </div>
    );
}

function Num({ label, value, min, max, step, onChange, suffix }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) {
    return (
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            {label}
            <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20 accent-(--doc-accent)" />
            <span className="w-8 tabular-nums text-ink">
                {suffix === "%" ? Math.round(value * 100) : value}
                {suffix}
            </span>
        </label>
    );
}

const STYLE_TOOLS: DocTool[] = ["note", "highlight", "underline", "strikeout", "draw", "rect", "oval", "line", "arrow", "textbox", "fill"];

// The options of the tool in hand, in a strip under the toolbar.
export function ToolOptions() {
    const tool = useDoc((s) => s.tool);
    const marks = useDoc((s) => s.info?.redactionMarks ?? 0);
    const imageSel = useDoc((s) => s.imageSel);
    const page = useDoc((s) => s.page);
    const stamp = useDoc((s) => s.stamp);
    useDoc((s) => s.styles);
    const style = styleFor(tool);
    const hint: Partial<Record<DocTool, string>> = {
        note: "Click on the page to add a comment.",
        highlight: "Drag across text to highlight it.",
        underline: "Drag across text to underline it.",
        strikeout: "Drag across text to strike it through.",
        draw: "Draw freehand on the page.",
        rect: "Drag to draw a rectangle.",
        oval: "Drag to draw an ellipse.",
        line: "Drag to draw a line.",
        arrow: "Drag to draw an arrow.",
        textbox: "Click or drag to add a text box, then type.",
        stamp: `Click to place the "${STAMPS.find((s) => s.id === stamp)?.label ?? stamp}" stamp.`,
        fill: "Click where you want to type. Enter adds it.",
        check: "Click to place a check mark.",
        cross: "Click to place a cross mark.",
        sign: "Click on the page to place your signature.",
        edit: "Click a line of text to change it. Drag an image to move it.",
        redact: "Drag over areas or select text to mark them for redaction, then apply.",
    };
    if (tool === "select" || tool === "hand") return null;
    return (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-panel-border bg-panel px-3 py-1.5 text-[11px] text-ink [&_button]:whitespace-nowrap">
            <span className="text-ink-muted">{hint[tool]}</span>
            {STYLE_TOOLS.includes(tool) && (
                <>
                    {tool !== "fill" && <Swatches tool={tool} />}
                    {(tool === "highlight" || tool === "draw" || tool === "rect" || tool === "oval") && <Num label="Opacity" value={style.opacity} min={0.1} max={1} step={0.05} suffix="%" onChange={(v) => setToolStyle(tool, { opacity: v })} />}
                    {(tool === "draw" || tool === "rect" || tool === "oval" || tool === "line" || tool === "arrow") && <Num label="Width" value={style.width} min={0.5} max={12} step={0.5} suffix="pt" onChange={(v) => setToolStyle(tool, { width: v })} />}
                    {(tool === "textbox" || tool === "fill") && <Num label="Size" value={style.fontSize} min={6} max={48} step={1} suffix="pt" onChange={(v) => setToolStyle(tool, { fontSize: v })} />}
                </>
            )}
            {tool === "sign" && (
                <button type="button" onClick={() => docView.set({ dialog: "signature" })} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                    Change signature
                </button>
            )}
            {tool === "redact" && (
                <>
                    <div className="flex-1" />
                    <span className="text-ink-muted">
                        {marks} area{marks === 1 ? "" : "s"} marked
                    </span>
                    <button type="button" disabled={!marks} onClick={() => edit({ op: "clearRedactions" })} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover disabled:opacity-40">
                        Clear marks
                    </button>
                    <button
                        type="button"
                        disabled={!marks}
                        onClick={() => {
                            if (window.confirm(`Apply ${marks} redaction${marks === 1 ? "" : "s"}? What they cover is removed from the PDF for good.`) && edit({ op: "applyRedactions" })) editor.notify("Redactions applied. The covered content is gone from the PDF.");
                        }}
                        className="h-6 rounded-md px-2.5 font-semibold text-white disabled:opacity-40"
                        style={{ background: "#E5484D" }}
                    >
                        Apply redactions
                    </button>
                </>
            )}
            {tool === "edit" && (
                <>
                    <div className="flex-1" />
                    {imageSel && (
                        <>
                            <span className="text-ink-muted">Image:</span>
                            <button type="button" onClick={() => void replacePageImage(imageSel.page, imageSel.index)} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                                Replace
                            </button>
                            <button type="button" onClick={() => edit({ op: "editImage", page: imageSel.page, index: imageSel.index, rotate: 1 })} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                                Rotate
                            </button>
                            <button type="button" onClick={() => edit({ op: "editImage", page: imageSel.page, index: imageSel.index, delete: true }, { imageSel: null })} className="h-6 rounded-md border border-panel-border px-2 text-red-400 hover:bg-panel-hover">
                                Delete
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={async () => {
                            const p = docView.get().info?.pages[page];
                            const text = await askText("Text to add");
                            if (p && text?.trim()) edit({ op: "addText", page, rect: [72, 72, Math.min(p.width - 36, 72 + 360), 96], text: text.trim(), size: styleFor("fill").fontSize });
                        }}
                        className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover"
                    >
                        Add text
                    </button>
                    <button type="button" onClick={() => void addImageToPage(page)} className="h-6 rounded-md border border-panel-border px-2 hover:bg-panel-hover">
                        Add image
                    </button>
                </>
            )}
        </div>
    );
}

// Page and zoom controls, floating at the bottom of the pages.
export function NavBar() {
    const page = useDoc((s) => s.page);
    const count = useDoc((s) => s.info?.pages.length ?? 0);
    const zoom = useDoc((s) => s.zoom);
    const fit = useDoc((s) => s.fit);
    const [draft, setDraft] = useState<string | null>(null);
    const btn = "flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-30";
    return (
        <div className="pointer-events-auto flex h-9 items-center gap-0.5 rounded-xl border border-panel-border bg-panel px-1.5 text-[12px] text-ink shadow-lg">
            <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => scrollToPage(page - 1)} className={btn}>
                <ChevronLeft className="size-4" />
            </button>
            <input
                aria-label="Page number"
                value={draft ?? String(page + 1)}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => setDraft(null)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        const n = Number(draft);
                        if (Number.isFinite(n)) scrollToPage(n - 1);
                        (e.target as HTMLInputElement).blur();
                    }
                }}
                className="h-6 w-9 rounded border border-panel-border bg-field text-center tabular-nums outline-none focus:border-brand-500"
            />
            <span className="px-1 text-ink-muted">/ {count}</span>
            <button type="button" aria-label="Next page" disabled={page >= count - 1} onClick={() => scrollToPage(page + 1)} className={btn}>
                <ChevronRight className="size-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-panel-border" />
            <button type="button" aria-label="Zoom out" title="Zoom out (⌘-)" onClick={() => setZoom(zoom / 1.2)} className={btn}>
                <ZoomOut className="size-4" />
            </button>
            <AriaMenuTrigger>
                <AriaButton aria-label="Zoom" className="h-7 w-14 rounded-md text-center tabular-nums outline-none hover:bg-panel-hover">
                    {Math.round(zoom * 100)}%
                </AriaButton>
                <AriaPopover placement="top" offset={6} className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        aria-label="Zoom"
                        className="outline-none"
                        onAction={(k) => {
                            const key = String(k);
                            if (key === "width" || key === "page") docView.set({ fit: key, zoom: fitZoom(key) });
                            else if (key === "in") setZoom(zoom * 1.2);
                            else if (key === "out") setZoom(zoom / 1.2);
                            else setZoom(Number(key));
                        }}
                    >
                        <MenuRow id="in" label="Zoom in" shortcut="⌘=" />
                        <MenuRow id="out" label="Zoom out" shortcut="⌘-" />
                        <MenuRow id="width" label="Fit width" shortcut="⇧1" checked={fit === "width"} />
                        <MenuRow id="page" label="Fit page" shortcut="⇧2" checked={fit === "page"} />
                        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => (
                            <MenuRow key={z} id={String(z)} label={`${z * 100}%`} shortcut={z === 1 ? "⌘0" : undefined} checked={!fit && Math.abs(zoom - z) < 0.001} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <button type="button" aria-label="Zoom in" title="Zoom in (⌘=)" onClick={() => setZoom(zoom * 1.2)} className={btn}>
                <ZoomIn className="size-4" />
            </button>
        </div>
    );
}

// Find in document: matches highlighted on the pages, Enter for the next one.
export function SearchBar() {
    const open = useDoc((s) => s.searchOpen);
    const query = useDoc((s) => s.query);
    const hits = useDoc((s) => s.hits);
    const hit = useDoc((s) => s.hit);
    const ref = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(query);
    // Whether Enter has gone to a match of this search yet (the first Enter shows the first).
    const stepped = useRef(false);
    useEffect(() => {
        if (open) ref.current?.focus();
    }, [open]);
    useEffect(() => {
        stepped.current = false;
        if (!open) return;
        const t = window.setTimeout(() => runSearch(draft), 150);
        return () => window.clearTimeout(t);
    }, [draft, open]);
    if (!open) return null;
    const go = (i: number) => {
        const all = docView.get().hits;
        if (!all.length) return;
        const n = (i + all.length) % all.length;
        docView.set({ hit: n });
        const h = all[n];
        if (h) scrollToPage(h.page, h.rects[0]?.[1] ?? 0, true);
    };
    return (
        <div role="search" className="absolute right-4 top-3 z-30 flex h-9 items-center gap-1 rounded-lg border border-panel-border bg-panel px-2 text-[12px] text-ink shadow-xl">
            <SearchLg className="size-3.5 text-ink-muted" />
            <input
                ref={ref}
                aria-label="Find in document"
                value={draft}
                placeholder="Find in document"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        if (docView.get().query !== draft) {
                            runSearch(draft);
                            stepped.current = false;
                        }
                        const now = docView.get().hit;
                        go(!stepped.current ? 0 : e.shiftKey ? now - 1 : now + 1);
                        stepped.current = true;
                    }
                    if (e.key === "Escape") docView.set({ searchOpen: false, hits: [], query: "" });
                }}
                className="h-7 w-48 bg-transparent outline-none"
            />
            <span className="w-14 text-right tabular-nums text-ink-muted">{draft ? (hits.length ? `${hit + 1} of ${hits.length}` : "None") : ""}</span>
            <button type="button" aria-label="Previous match" onClick={() => go(hit - 1)} className="rounded p-1 hover:bg-panel-hover">
                <ChevronLeft className="size-3.5" />
            </button>
            <button type="button" aria-label="Next match" onClick={() => go(hit + 1)} className="rounded p-1 hover:bg-panel-hover">
                <ChevronRight className="size-3.5" />
            </button>
            <button type="button" aria-label="Close find" onClick={() => docView.set({ searchOpen: false, hits: [], query: "" })} className="rounded p-1 hover:bg-panel-hover">
                <X className="size-3.5" />
            </button>
        </div>
    );
}

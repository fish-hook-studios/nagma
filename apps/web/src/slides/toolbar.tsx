import { ChevronDown, ChevronLeft, Hand, Plus, SearchSm, X } from "@untitledui/icons";
import { useEffect, useReducer, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { AssetsPanel } from "../components/assets-panel";
import { MenuRow } from "../components/left-sidebar";
import { COMMENT_ONLY, FRAME_ONLY, MOVE, PENS, SHAPES, TEXT, ToolButton, ToolGroup, pickTool } from "../components/toolbar";
import { ActionsIcon, DesignModeIcon, ScaleIcon } from "../components/toolbar-icons";
import { viewCenter } from "../engine/actions";
import { pickImages } from "../engine/images";
import { openActions } from "../engine/modes";
import { editor, useEditor } from "../engine/store";
import { requestAccess, useCollab } from "../engine/collab";
import type { Tool } from "../engine/types";
import { SLIDES_ORANGE } from "./model";
import { MENU_CLASS } from "./slide-list";
import { slides, useSlides } from "./state";
import { type WidgetKind, blankTable, insertSlideNumber, insertTable, insertWidget } from "./widgets";

// The floating toolbar under the slide. Slides mode: move, text, image or video, shapes,
// interactive widgets, comments, assets and insert. Design mode: the design editor's tool groups
// (move, frame, shape, pen, text, comment), actions and insert. Both end with the mode switch.

// The shapes flyout: a 168 × 128 grid of 40pt cells over the toolbar. Closed shapes go on the
// slide with room for text; the line and arrow are drawn. (Plain rectangles and ellipses are
// drawn with R and O, or from Design mode's toolbar.)
type ShapeCell = { id: string; label: string; kind?: WidgetKind; tool?: Tool; glyph: React.ReactNode };
const g = (d: React.ReactNode) => (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        {d}
    </svg>
);
const SHAPE_CELLS: ShapeCell[] = [
    { id: "square", label: "Square", kind: "text-rect", glyph: g(<rect x="3.5" y="3.5" width="13" height="13" rx="0.5" />) },
    { id: "circle", label: "Circle", kind: "text-ellipse", glyph: g(<circle cx="10" cy="10" r="7" />) },
    { id: "diamond", label: "Diamond", kind: "text-diamond", glyph: g(<path d="M10 2.5 17.5 10 10 17.5 2.5 10z" />) },
    { id: "triangle", label: "Triangle", kind: "text-triangle", glyph: g(<path d="M10 3 17.5 16.5h-15z" />) },
    { id: "star", label: "Star", kind: "text-star", glyph: g(<path d="m10 2.8 2.1 4.6 5 .5-3.7 3.4 1.1 4.9L10 13.7l-4.5 2.5 1.1-4.9L2.9 7.9l5-.5z" />) },
    { id: "cross", label: "Cross", kind: "text-cross", glyph: g(<path d="M7.5 3h5v4.5H17v5h-4.5V17h-5v-4.5H3v-5h4.5z" />) },
    { id: "arrow-left", label: "Left arrow", kind: "text-arrow-left", glyph: g(<path d="M2.5 10 8 5v3h9.5v4H8v3z" />) },
    { id: "arrow-right", label: "Right arrow", kind: "text-arrow-right", glyph: g(<path d="M17.5 10 12 5v3H2.5v4H12v3z" />) },
    { id: "bubble", label: "Speech bubble", kind: "text-bubble", glyph: g(<path d="M10 4c4.1 0 7.5 2.3 7.5 5.2s-3.4 5.2-7.5 5.2c-.8 0-1.6-.1-2.3-.3L4 16l.9-3.1C3.4 11.9 2.5 10.6 2.5 9.2 2.5 6.3 5.9 4 10 4z" />) },
    { id: "line", label: "Line (L)", tool: "line", glyph: g(<path d="M4 16 16 4" />) },
    { id: "arrow", label: "Arrow (⇧L)", tool: "arrow", glyph: g(<path d="M4 16 16 4M9 4h7v7" />) },
    { id: "rounded", label: "Rounded rectangle", kind: "text-rounded", glyph: g(<rect x="3" y="5" width="14" height="10" rx="3" />) },
];

function ShapesGrid({ active }: { active: boolean }) {
    const [open, setOpen] = useState(false);
    return (
        <AriaDialogTrigger isOpen={open} onOpenChange={setOpen}>
            <Tip label="Shapes">
                <AriaButton aria-label="Shapes" className={menuButton} style={active || open ? { background: SLIDES_ORANGE, color: "#fff" } : undefined}>
                    <ShapesIcon className="size-5" />
                </AriaButton>
            </Tip>
            <AriaPopover placement="top" offset={16} className="rounded-[13px] bg-panel p-1 text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.3)] outline-none">
                <AriaDialog aria-label="Shapes" className="grid w-40 grid-cols-4 outline-none">
                    {SHAPE_CELLS.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            aria-label={c.label}
                            title={c.label}
                            onClick={() => {
                                setOpen(false);
                                if (c.kind) insertWidget(c.kind);
                                else if (c.tool) editor.set({ tool: c.tool });
                            }}
                            className="flex size-10 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                            {c.glyph}
                        </button>
                    ))}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// Live interaction: a 460 × 437 panel over the toolbar with a line about it and a card for each
// kind (Poll, Stamps, Alignment, Prototype; then Facepile, Embed and Video from a link).
const LIVE_CARDS: { id: WidgetKind | "prototype"; label: string; picture: React.ReactNode }[] = [
    {
        id: "poll",
        label: "Poll",
        picture: (
            <span className="flex w-[142px] flex-col gap-1.5 rounded-[6px] bg-white p-3 text-left shadow-sm">
                <span className="text-[8px] font-semibold text-black">Which direction do you like?</span>
                <span className="flex h-3 items-center rounded-[2px] bg-[#e6e6e6] px-1 text-[5px] text-black">Direction A</span>
                <span className="flex h-3 items-center rounded-[2px] bg-[#14ae5c] px-1 text-[5px] text-white" style={{ width: "75%" }}>Direction B</span>
            </span>
        ),
    },
    {
        id: "stamps",
        label: "Stamps",
        picture: (
            <span className="flex w-[142px] flex-col gap-2 rounded-[6px] bg-white p-3 text-left shadow-sm">
                <span className="text-[8px] font-semibold text-black">I've reviewed this deck</span>
                <span className="flex gap-1">
                    {["#c47b3c", "#7a5230", "#3d3d3d", "#9747ff"].map((c) => (
                        <span key={c} className="size-3 rounded-full" style={{ background: c }} />
                    ))}
                    <span className="size-3 rounded-full border border-dashed border-[#b3b3b3]" />
                </span>
            </span>
        ),
    },
    {
        id: "scale",
        label: "Alignment",
        picture: (
            <span className="flex w-[150px] flex-col gap-2 rounded-[6px] bg-white p-2.5 text-left shadow-sm">
                <span className="text-[7px] font-semibold text-black">Do we agree with this decision?</span>
                <span className="relative h-3 rounded-[2px] border border-[#e6e6e6]">
                    <span className="absolute inset-x-1 top-1/2 h-px bg-gradient-to-r from-[#f24822] via-[#ffcd29] to-[#14ae5c]" />
                </span>
            </span>
        ),
    },
    {
        id: "prototype",
        label: "Prototype",
        picture: (
            <span className="flex h-16 w-[86px] items-center justify-center rounded-[6px] bg-white text-black shadow-sm">
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2.5" />
                    <path d="M4 9h16M8 3v4M16 3v4M10.5 11.8v5l4-2.5z" />
                </svg>
            </span>
        ),
    },
    { id: "facepile", label: "Facepile", picture: <span className="flex -space-x-1.5">{["#c47b3c", "#3d3d3d", "#9747ff", "#14ae5c"].map((c) => <span key={c} className="size-6 rounded-full border-2 border-white" style={{ background: c }} />)}</span> },
    { id: "embed", label: "Embed", picture: <span className="flex h-12 w-24 items-center justify-center rounded-[6px] bg-white text-[8px] text-[#7f7f7f] shadow-sm">https://</span> },
    { id: "video-link", label: "Video from a link", picture: <span className="flex h-12 w-20 items-center justify-center rounded-[6px] bg-black text-white shadow-sm"><svg viewBox="0 0 12 12" className="size-4" fill="currentColor" aria-hidden="true"><path d="M4 2.5v7l5.5-3.5z" /></svg></span> },
];

function LiveInteraction() {
    const [open, setOpen] = useState(false);
    return (
        <AriaDialogTrigger isOpen={open} onOpenChange={setOpen}>
            <Tip label="Live interaction">
                <AriaButton aria-label="Live interaction" className={menuButton} style={open ? { background: SLIDES_ORANGE, color: "#fff" } : undefined}>
                    <InteractiveIcon className="size-5" />
                </AriaButton>
            </Tip>
            <AriaPopover placement="top" offset={16} className="flex h-[437px] max-h-[calc(100vh-96px)] w-[460px] flex-col overflow-hidden rounded-[13px] bg-panel text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.3)] outline-none">
                <AriaDialog aria-label="Live interaction" className="flex min-h-0 flex-1 flex-col outline-none">
                    <div className="flex h-10 shrink-0 items-center justify-between border-b border-panel-border pr-2 pl-4">
                        <h2 className="text-[11px] font-semibold">Live interaction</h2>
                        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-[15px] pt-4 pb-4">
                        <p className="mb-4 text-[11px] leading-4 text-ink-muted">Give your audience something to interact with when you present, like a quick poll or interactive prototype.</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                            {LIVE_CARDS.map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    aria-label={c.label}
                                    onClick={() => {
                                        setOpen(false);
                                        if (c.id === "prototype") slides.set({ prototypeOpen: true });
                                        else insertWidget(c.id);
                                    }}
                                    className="group flex flex-col gap-2 text-left outline-none"
                                >
                                    <span className="flex h-[126px] w-full items-center justify-center rounded-[5px] bg-field group-hover:ring-1 group-hover:ring-ink-subtle group-focus-visible:ring-2 group-focus-visible:ring-brand-500">{c.picture}</span>
                                    <span className="text-[11px] font-semibold">{c.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// The toolbar's tooltip: a 24pt dark label over the button with a caret, the shortcut in grey.
// The tip shows on hover after 500ms and again after a press while the pointer stays on the tool
// (React Aria keeps a pressed trigger's tooltip shut until the pointer leaves). A press that opens
// a menu or panel (aria-expanded) leaves it shut.
export function Tip({ label, children }: { label: string; children: React.ReactElement }) {
    const m = /^(.*) \((.+)\)$/.exec(label);
    const [open, setOpen] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    const over = useRef(false);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const later = (target: EventTarget) => {
        window.clearTimeout(timer.current);
        const button = (target as Element).closest?.("button");
        timer.current = window.setTimeout(() => {
            if (over.current && button?.getAttribute("aria-expanded") !== "true") setOpen(true);
        }, 500);
    };
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0} isOpen={open} onOpenChange={setOpen}>
            <span
                className="contents"
                onPointerEnter={() => (over.current = true)}
                onPointerLeave={() => {
                    over.current = false;
                    window.clearTimeout(timer.current);
                }}
                onPointerUp={(e) => later(e.target)}
            >
                {children}
            </span>
            <AriaTooltip placement="top" offset={10} className="relative flex h-6 items-center gap-2 rounded-[5px] bg-tooltip px-2 text-[11px] text-white shadow-lg ring-1 ring-[#363636]">
                <span>{m ? m[1] : label}</span>
                {m && <span className="text-[#b1b1b1]">{m[2]}</span>}
                <span aria-hidden="true" className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-tooltip" />
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

function SlideToolButton({ label, active, onPress, children }: { label: string; active?: boolean; onPress: () => void; children: React.ReactNode }) {
    return (
        <Tip label={label}>
            <AriaButton
                aria-label={label}
                aria-pressed={active}
                onPress={onPress}
                className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "text-white" : "text-ink hover:bg-panel-hover"}`}
                style={active ? { background: SLIDES_ORANGE } : undefined}
            >
                {children}
            </AriaButton>
        </Tip>
    );
}

const menuButton = "flex size-8 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 data-[pressed]:bg-panel-hover";

type IconProps = React.SVGProps<SVGSVGElement>;

function TextIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M3.5 5.5V3.5h13v2M10 3.5v13M7.5 16.5h5" />
        </svg>
    );
}

function ImageIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="2.75" y="2.75" width="14.5" height="14.5" rx="2" />
            <circle cx="12.75" cy="7" r="1.5" />
            <path d="M2.75 14.5l4.5-4.25 4.25 4 2-1.75 3.75 3.25" />
        </svg>
    );
}

// A circle behind a square: the shapes menu.
function ShapesIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...props}>
            <path d="M8.5 13.9A5.25 5.25 0 1 1 13.9 8.5" />
            <rect x="8.5" y="8.5" width="9" height="9" rx="1.75" />
        </svg>
    );
}

// A finger tapping: polls, scales, live stamps and embeds.
function InteractiveIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M5.2 9.6a5.2 5.2 0 1 1 9.9-1.6" />
            <path d="M7.8 9.1a2.6 2.6 0 1 1 5.1 0" />
            <path d="M10.3 17.5l-2.6-3a1.2 1.2 0 0 1 1.8-1.6l.9.9V9.4a1.1 1.1 0 0 1 2.2 0v3.1l2.6.6a1.6 1.6 0 0 1 1.2 1.8l-.4 2.6" />
        </svg>
    );
}

function BubbleIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...props}>
            <path d="M10 2.9a7.1 7.1 0 1 1-3.5 13.3l-3.6.9.9-3.6A7.1 7.1 0 0 1 10 2.9z" />
        </svg>
    );
}

// Four little shapes: the assets panel.
function AssetsIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M6 2.6l3.2 3.2L6 9 2.8 5.8z" />
            <circle cx="14.2" cy="5.8" r="3" />
            <rect x="2.9" y="11.2" width="6.1" height="6.1" rx="1.4" />
            <path d="M14.2 11v6.5M11 14.2h6.5" />
        </svg>
    );
}

// The "+" panel (480 × 612 over the toolbar): a search, Other tools (Table, sized on a grid;
// Code block; Chart; Slide number) and Libraries, whose card opens the libraries' components.
const OTHER_TOOLS: { id: "table" | "code" | "chart" | "number"; label: string; icon: React.FC<IconProps> }[] = [
    { id: "table", label: "Table", icon: TableIcon },
    { id: "code", label: "Code block", icon: CodeIcon },
    { id: "chart", label: "Chart", icon: ChartIcon },
    { id: "number", label: "Slide number", icon: NumberIcon },
];

function InsertPanel() {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<"home" | "table" | "libraries">("home");
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const tools = OTHER_TOOLS.filter((t) => !q || t.label.toLowerCase().includes(q));
    const close = () => setOpen(false);
    return (
        <AriaDialogTrigger
            isOpen={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    setView("home");
                    setQuery("");
                }
            }}
        >
            <Tip label="Assets">
                <AriaButton aria-label="Insert" className={`${menuButton} group`}>
                    <span className={`flex size-6 items-center justify-center rounded-full ${open ? "text-white" : "bg-field group-hover:bg-transparent"}`} style={open ? { background: SLIDES_ORANGE } : undefined}>
                        <Plus className="size-4" />
                    </span>
                </AriaButton>
            </Tip>
            <AriaPopover placement="top" offset={16} className="flex h-[612px] max-h-[calc(100vh-96px)] w-[480px] flex-col overflow-hidden rounded-[13px] bg-panel text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.3)] outline-none">
                <AriaDialog aria-label="Assets" className="flex min-h-0 flex-1 flex-col outline-none">
                    {view === "libraries" ? (
                        <>
                            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                                <button type="button" aria-label="Back" onClick={() => setView("home")} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                                    <ChevronLeft className="size-4" />
                                </button>
                                <span className="text-[13px] font-medium">Libraries</span>
                            </div>
                            <div className="flex min-h-0 flex-1 flex-col">
                                <AssetsPanel />
                            </div>
                        </>
                    ) : view === "table" ? (
                        <>
                            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                                <button type="button" aria-label="Back" onClick={() => setView("home")} className="flex size-6 items-center justify-center rounded-[5px] text-ink hover:bg-panel-hover">
                                    <ChevronLeft className="size-4" />
                                </button>
                                <span className="text-[13px] font-medium">Table</span>
                            </div>
                            <div className="p-4">
                                <TableSizeGrid
                                    onPick={(rows, cols) => {
                                        close();
                                        insertTable(blankTable(rows, cols));
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex h-12 shrink-0 items-center px-2">
                                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-panel-border px-2 focus-within:border-[#F24E1E]">
                                    <SearchSm className="size-4 shrink-0 text-ink-muted" />
                                    <input autoFocus aria-label="Search assets" placeholder="Search assets..." value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
                                </label>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                                {tools.length > 0 && <div className="flex h-8 items-center px-2 text-[11px] font-semibold">Other tools</div>}
                                {tools.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                            if (t.id === "table") return setView("table");
                                            close();
                                            if (t.id === "number") insertSlideNumber();
                                            else insertWidget(t.id);
                                        }}
                                        className="flex h-10 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500"
                                    >
                                        <t.icon className="size-4 shrink-0" />
                                        {t.label}
                                    </button>
                                ))}
                                {!q && (
                                    <>
                                        <div className="mt-2 flex h-8 items-center px-2 text-[11px] font-semibold">Libraries</div>
                                        <div className="px-2">
                                            <button type="button" onClick={() => setView("libraries")} className="flex h-[120px] w-[207px] flex-col items-center justify-center gap-2 rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                                                <Plus className="size-4" />
                                                Add your own
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function TableIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" {...props}>
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
            <path d="M2 6.2h12M2 9.8h12M6 2.5v11" />
        </svg>
    );
}

function CodeIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8" />
            <path d="M8.5 2.5h5v5M13.5 2.5 8 8" />
        </svg>
    );
}

function ChartIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" {...props}>
            <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
        </svg>
    );
}

function NumberIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" {...props}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M6.2 6.8h3.6M6.2 9.2h3.6M7.2 5.5l-.4 5M9.2 5.5l-.4 5" />
        </svg>
    );
}

const GRID = 10;

// Drag (or move) across the squares for the table's rows and columns; release or click to add it.
function TableSizeGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
    const [size, setSize] = useState({ rows: 3, cols: 3 });
    const fromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        // Each square is 16px with a 3px gap.
        const cell = 19;
        return { cols: Math.max(1, Math.min(GRID, Math.ceil((e.clientX - r.left) / cell))), rows: Math.max(1, Math.min(GRID, Math.ceil((e.clientY - r.top) / cell))) };
    };
    return (
        <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
                <span className="font-semibold">Table</span>
                <span className="tabular-nums text-ink-muted" aria-live="polite">{size.cols} × {size.rows}</span>
            </div>
            <div
                role="grid"
                aria-label="Table size: columns by rows"
                tabIndex={0}
                className="grid w-max cursor-pointer gap-[3px] outline-none"
                style={{ gridTemplateColumns: `repeat(${GRID}, 16px)` }}
                onPointerMove={(e) => setSize(fromEvent(e))}
                onPointerUp={(e) => onPick(fromEvent(e).rows, fromEvent(e).cols)}
                onKeyDown={(e) => {
                    const step: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
                    const d = step[e.key];
                    if (d) {
                        e.preventDefault();
                        setSize((s) => ({ rows: Math.max(1, Math.min(GRID, s.rows + d[0])), cols: Math.max(1, Math.min(GRID, s.cols + d[1])) }));
                    } else if (e.key === "Enter") onPick(size.rows, size.cols);
                }}
            >
                {Array.from({ length: GRID * GRID }, (_, i) => {
                    const r = Math.floor(i / GRID) + 1;
                    const c = (i % GRID) + 1;
                    const on = r <= size.rows && c <= size.cols;
                    return <span key={i} className={`size-4 rounded-[3px] border ${on ? "border-brand-500 bg-brand-500/40" : "border-panel-border"}`} />;
                })}
            </div>
            <div className="text-ink-muted">Paste cells from a spreadsheet or drop a CSV file for a table with data.</div>
        </div>
    );
}

// Slides mode and Design mode, at the end of the bar.
function ModeSwitch() {
    const mode = useSlides((s) => s.mode);
    const button = "flex size-7 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
    return (
        <div role="radiogroup" aria-label="Mode" className="flex items-center gap-0.5 rounded-[6px] bg-panel-border p-0.5">
            <button type="button" role="radio" aria-checked={mode === "slides"} aria-label="Slides mode" title="Slides mode" onClick={() => slides.set({ mode: "slides" })} className={`${button} ${mode === "slides" ? "bg-panel" : "text-ink hover:bg-panel-hover"}`} style={mode === "slides" ? { color: "#FF8F6B" } : undefined}>
                <SlidesModeIcon className="size-[18px]" />
            </button>
            <button type="button" role="radio" aria-checked={mode === "design"} aria-label="Design mode" title="Design mode (⇧D)" onClick={() => slides.set({ mode: "design" })} className={`${button} ${mode === "design" ? "bg-panel text-brand-500" : "text-ink hover:bg-panel-hover"}`}>
                <DesignModeIcon className="size-[18px]" />
            </button>
        </div>
    );
}

const BAR = "pointer-events-auto flex h-12 items-center rounded-[13px] bg-panel text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_10px_rgba(0,0,0,0.3)]";

export function SlidesToolbar() {
    const mode = useSlides((s) => s.mode);
    return mode === "design" ? <DesignBar /> : <SlidesBar />;
}

function SlidesBar() {
    const tool = useEditor((s) => s.tool);
    const readOnly = useEditor((s) => s.readOnly);
    const shapeActive = SHAPE_CELLS.some((c) => c.tool === tool);
    const setTool = (t: Tool) => editor.set({ tool: t });
    return (
        <div role="toolbar" aria-label="Slide tools" className={`${BAR} gap-2 px-2`}>
            <div className="flex items-center">
                <SlideToolButton label={tool === "hand" ? "Hand tool (H)" : tool === "scale" ? "Scale (K)" : "Move (V)"} active={tool === "move" || tool === "hand" || tool === "scale"} onPress={() => setTool(tool === "hand" || tool === "scale" ? tool : "move")}>
                    {tool === "hand" ? <Hand className="size-5" /> : tool === "scale" ? <ScaleIcon className="size-5" /> : <MoveIcon className="size-5" />}
                </SlideToolButton>
                <AriaMenuTrigger>
                    <AriaButton aria-label="Move tools" className="flex h-8 w-4 items-center justify-center rounded text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        <ChevronDown className="size-3" />
                    </AriaButton>
                    <AriaPopover placement="top start" offset={14} className={MENU_CLASS}>
                        <AriaMenu aria-label="Move tools" className="outline-none" onAction={(key) => setTool(String(key) as Tool)}>
                            <MenuRow id="move" label="Move" icon={MoveIcon} shortcut="V" checked={tool !== "hand" && tool !== "scale"} />
                            <MenuRow id="hand" label="Hand tool" icon={Hand} shortcut="H" checked={tool === "hand"} />
                            <MenuRow id="scale" label="Scale" icon={ScaleIcon} shortcut="K" checked={tool === "scale"} />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>
            {!readOnly && (
                <>
                    <SlideToolButton label="Text (T)" active={tool === "text"} onPress={() => setTool("text")}>
                        <TextIcon className="size-5" />
                    </SlideToolButton>
                    <SlideToolButton label="Image or video" onPress={() => pickImages(viewCenter)}>
                        <ImageIcon className="size-5" />
                    </SlideToolButton>
                    <ShapesGrid active={shapeActive} />
                    <LiveInteraction />
                </>
            )}
            <SlideToolButton label="Comment (C)" active={tool === "comment"} onPress={() => setTool("comment")}>
                <BubbleIcon className="size-5" />
            </SlideToolButton>
            {!readOnly && (
                <>
                    <SlideToolButton label="Actions (⌘K)" onPress={openActions}>
                        <AssetsIcon className="size-5" />
                    </SlideToolButton>
                    <InsertPanel />
                </>
            )}
            {readOnly && <AskToEdit />}
            <div className="h-12 w-px bg-panel-border" />
            <ModeSwitch />
        </div>
    );
}

// Viewers ask the owner for edit access from the toolbar.
function AskToEdit() {
    const fileId = useCollab((s) => s.fileId);
    const [asked, setAsked] = useState(false);
    const done = asked;
    return (
        <button
            type="button"
            disabled={done || !fileId}
            title={fileId ? undefined : "Share the file to ask for access"}
            onClick={() =>
                fileId &&
                void requestAccess(fileId, "edit").then((error) => {
                    if (error) editor.notify(error);
                    else {
                        setAsked(true);
                        editor.notify("Edit access requested. The owner gets a notification.");
                    }
                })
            }
            className="ml-1 h-8 shrink-0 rounded-[7px] px-3 text-[11.5px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
            style={{ background: SLIDES_ORANGE }}
        >
            {done ? "Edit access requested" : "Ask to edit"}
        </button>
    );
}

// Design mode: the design editor's groups (each remembers the tool picked last), Actions, Insert.
function DesignBar() {
    const active = useEditor((s) => s.tool);
    const readOnly = useEditor((s) => s.readOnly);
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const pick = (group: Parameters<typeof pickTool>[0], def: Parameters<typeof pickTool>[1]) => {
        pickTool(group, def);
        bump();
    };
    const groups = readOnly ? [MOVE, COMMENT_ONLY] : [MOVE, FRAME_ONLY, SHAPES, PENS, TEXT, COMMENT_ONLY];
    return (
        <div role="toolbar" aria-label="Design tools" className={`${BAR} gap-2 px-2`}>
            {/* As the reference: 8 between the groups, 1 between a tool and its menu chevron. */}
            <div className="flex items-center gap-2 [&>div]:gap-px">
                {groups.map((group) => (
                    <ToolGroup key={group.id} group={group} active={active} onPick={pick} />
                ))}
                <ToolButton def={{ tool: "move", label: "Actions", shortcut: "⌘K", icon: ActionsIcon }} active={false} onPress={openActions} />
                {!readOnly && <InsertPanel />}
            </div>
            <div className="h-12 w-px bg-panel-border" />
            <ModeSwitch />
        </div>
    );
}

function MoveIcon(props: IconProps) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" {...props}>
            <path d="M4 3.5l12 4.6-5.3 1.9-2 5.5z" />
        </svg>
    );
}

// A slide on an easel.
export function SlidesModeIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect x="2.75" y="3.25" width="14.5" height="10" rx="1.75" />
            <path d="M6.5 13.25l-1.25 4M13.5 13.25l1.25 4M6 6.75h3.5M6 9.5h2" />
        </svg>
    );
}

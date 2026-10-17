import { ChevronDown, Cursor01, Hand, Image01, LayoutGrid01, List, MessageCircle01, Plus, SearchSm, Stars02, Table, Type01, X } from "@untitledui/icons";
import { type ReactNode, useEffect, useState } from "react";
import { pickImages, readImage } from "../engine/images";
import { imageSrc } from "../engine/image-store";
import { editor, useEditor } from "../engine/store";
import type { Tool } from "../engine/types";
import { viewCenter } from "../engine/actions";
import { ADVANCED_SHAPES, CLOUD_SHAPES, BASIC_SHAPES, FLOWCHART_SHAPES, HIGHLIGHT_COLORS, INK_COLORS, SHAPE_COLORS, SHAPE_LABELS, STICKERS, STICKY_COLORS, TRAY_SHAPES, WASHI_PATTERNS, stampLook } from "./model";
import { ConnectorGlyph, HighlighterGlyph, SectionGlyph, ShapeGlyph } from "./icons";
import { type BoardTool, board, setBoardTool, useBoard } from "./state";
import type { ConnectorLine, ShapeKind, WashiPattern } from "./types";
import { linkFrom, placeLink } from "./links";
import { askText } from "../components/ask-text";
import { MIND_MAP_STYLES, insertMindMap } from "./mindmap";
import { BOARD_TEMPLATES, insertTemplate } from "./templates";
import { placeWidget } from "./widgets";
import { openWheel, pickStamp } from "./stamps";
import { isCodegen, loadPlugins, pickPluginManifest, runPlugin, usePlugins } from "../engine/plugins";
import { useCollab } from "../engine/collab";
import { useTeams } from "../engine/teams";
import { type TeamTemplate, loadTeamTemplates, startFromTemplate } from "../engine/team-templates";
import { amVoting } from "./voting";
import { generateIdeas, sortStickies, summarizeSelection } from "./ai";

// The board's floating toolbar along the bottom (48 high, 32pt tools), the 40pt option bar each tool
// opens above it (drawing tools, sticky colours, shapes and connectors), the Actions panel, the "+"
// panel (widgets, stickers, templates and more), and the Shapes panel on the left.

const DRAW_TOOLS: BoardTool[] = ["marker", "highlighter", "washi", "eraser"];
const DRAW_NAMES: Record<string, string> = { marker: "Marker", highlighter: "Highlighter", washi: "Washi tape", eraser: "Eraser" };

// A tooltip: a 24pt dark body with the name, the shortcut as a second grey run, and a 5pt caret
// pointing at the control. Toolbar tips sit above (the caret reaching 2pt into the toolbar);
// option-bar tips sit below the bar. `wrap` lets a long name take two lines in 180pt.
export function Tip({ label, shortcut, below, gap = 11, wrap, children }: { label: string; shortcut?: string; below?: boolean; gap?: number; wrap?: boolean; children: ReactNode }) {
    return (
        <span className="group/tip relative flex">
            {children}
            <span
                role="tooltip"
                className={`pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 items-center rounded-[5px] bg-[#1E1E1E] pl-[9px] pr-[9.5px] text-[11px] leading-4 text-white opacity-0 transition-opacity delay-0 group-hover/tip:opacity-100 group-hover/tip:delay-300 ${wrap ? "w-[180px] whitespace-normal py-1" : "h-6 whitespace-nowrap"}`}
                style={below ? { top: `calc(100% + ${gap}px)` } : { bottom: `calc(100% + ${gap}px)` }}
            >
                <span>
                    {label}
                    {shortcut && <span className="ml-3 text-[#B1B1B1]">{shortcut}</span>}
                </span>
                <span aria-hidden="true" className={`absolute left-1/2 -translate-x-1/2 border-x-[5px] border-x-transparent ${below ? "bottom-full border-b-[5px] border-b-[#1E1E1E]" : "top-full border-t-[5px] border-t-[#1E1E1E]"}`} />
            </span>
        </span>
    );
}

// A 32pt toolbar button.
function ToolButton({ label, shortcut, active, onPress, children, wrap, round }: { label: string; shortcut?: string; active?: boolean; onPress: () => void; children: ReactNode; wrap?: boolean; round?: boolean }) {
    return (
        <Tip label={label} shortcut={shortcut} wrap={wrap}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={onPress}
                className={`flex size-8 items-center justify-center outline-none transition-colors ${round ? "rounded-full" : "rounded-[5px]"} ${active ? "bg-[#9747FF] text-white" : round ? "bg-[#F5F5F5] text-[#1E1E1E] hover:bg-[#EBEBEB]" : "text-[#1E1E1E] hover:bg-black/5"}`}
            >
                {children}
            </button>
        </Tip>
    );
}

// A 32pt cell in an option bar, its tip below the bar.
function BarButton({ label, shortcut, active, onPress, children, disabled }: { label: string; shortcut?: string; active?: boolean; onPress: () => void; children: ReactNode; disabled?: boolean }) {
    return (
        <Tip label={label} shortcut={shortcut} below gap={7}>
            <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onPress} className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] outline-none disabled:opacity-30 ${active ? "bg-[#9747FF]/35" : "hover:bg-black/5"}`}>
                {children}
            </button>
        </Tip>
    );
}

// A 16pt round swatch in a 32pt cell; the picked one has a 2pt ring 2pt out.
function Swatch({ color, label, active, onPress, disabled }: { color: string; label: string; active?: boolean; onPress: () => void; disabled?: boolean }) {
    return (
        <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onPress} className="flex size-8 shrink-0 items-center justify-center outline-none disabled:opacity-30">
            <span className={`size-4 rounded-full border border-black/10 ${active ? "ring-2 ring-[#9747FF] ring-offset-2" : ""}`} style={{ background: color }} />
        </button>
    );
}

function ColorPicker({ value, onPick, disabled }: { value: string; onPick: (c: string) => void; disabled?: boolean }) {
    return (
        <label title="Custom colour" className={`relative flex size-8 shrink-0 items-center justify-center ${disabled ? "pointer-events-none opacity-30" : "cursor-pointer"}`}>
            <span className="size-4 rounded-full border border-black/10" style={{ background: "conic-gradient(#FF6B6B, #FFD166, #8BE38B, #6EC8FF, #B490FF, #FF8FD1, #FF6B6B)" }} />
            <input type="color" aria-label="Custom colour" disabled={disabled} value={value} onChange={(e) => onPick(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
    );
}

// The divider between a bar's groups: a full-height rule with 4pt either side.
const Rule = () => <span className="mx-1 h-10 w-px shrink-0 bg-black/[0.08]" />;

const bar = "pointer-events-auto flex h-10 items-center rounded-[13px] bg-white px-1 text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]";

// The marker's bar colours (the rest of the ink palette is one pick away in the colour picker, and in
// a stroke's own selection bar).
const MARKER_COLORS = ["#757575", "#FF7556", "#FF9E42", "#FFC943", "#66D575", "#3DADFF", "#9747FF", "#FFFFFF"].map((c) => INK_COLORS.find((k) => k.color === c) ?? { name: c, color: c });

function MarkerTip({ color }: { color: string }) {
    return (
        <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true">
            <path d="M5 24 L5 11 L8 3.5 Q10 1.5 12 3.5 L15 11 L15 24 Z" fill="#FFFFFF" stroke="#BDBDBD" strokeWidth="1" />
            <path d="M8.2 6.2 L10 1.8 L11.8 6.2 Z" fill={color} />
        </svg>
    );
}

function WashiSwatch({ pattern, color }: { pattern: WashiPattern; color: string }) {
    const mark = pattern === "dots" ? "radial-gradient(circle, rgba(255,255,255,.75) 1.1px, transparent 1.4px) 0 0/5px 5px" : pattern === "stripes" ? "repeating-linear-gradient(45deg, rgba(255,255,255,.7) 0 1.5px, transparent 1.5px 4px)" : pattern === "grid" ? "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px) 0 0/4px 4px, linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px) 0 0/4px 4px" : pattern === "checks" ? "conic-gradient(rgba(255,255,255,.9) 25%, transparent 0 50%, rgba(255,255,255,.9) 0 75%, transparent 0) 0 0/6px 6px" : pattern === "stars" ? "radial-gradient(circle, rgba(255,236,150,.95) 1px, transparent 1.3px) 0 0/5px 5px" : pattern === "waves" ? "repeating-radial-gradient(circle at 0 100%, transparent 0 2px, rgba(255,255,255,.7) 2px 3px)" : pattern === "hearts" ? "radial-gradient(circle, rgba(255,90,120,.8) 1.2px, transparent 1.5px) 0 0/6px 6px" : "none";
    return <span className="size-4 rounded-full border border-black/10" style={{ background: `${mark}, ${color}` }} />;
}

// One bar for all four drawing tools, 506 wide whichever is picked: the tools, two widths, then the
// colours (washi: the patterns), dimmed while the eraser is in hand.
function DrawTray() {
    const b = useBoard((s) => s);
    const tool = b.tool && DRAW_TOOLS.includes(b.tool) ? b.tool : "marker";
    const hl = tool === "highlighter";
    const erasing = tool === "eraser";
    const size = hl ? b.highlighterSize : b.markerSize;
    const sizes = hl ? [12, 28] : [4, 12];
    const colors = hl ? HIGHLIGHT_COLORS : MARKER_COLORS;
    const current = hl ? b.highlightColor : b.drawColor;
    const pick = (c: string) => board.set(hl ? { highlightColor: c } : { drawColor: c });
    return (
        <div className={`${bar} w-[506px]`} role="toolbar" aria-label="Drawing tools">
            <BarButton label="Marker" shortcut="M" active={tool === "marker"} onPress={() => setBoardTool("marker", "draw")}><MarkerTip color={b.drawColor} /></BarButton>
            <BarButton label="Highlighter" shortcut="⇧M" active={hl} onPress={() => setBoardTool("highlighter", "draw")}><HighlighterGlyph color={b.highlightColor} /></BarButton>
            <BarButton label="Washi tape" shortcut="W" active={tool === "washi"} onPress={() => setBoardTool("washi", "draw")}>
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="2" width="12" height="17" rx="1.5" fill="#EFE4FF" stroke="#9747FF" strokeWidth="1" /><path d="M4 7h12M4 11h12M4 15h12M8 2v17M12 2v17" stroke="#9747FF" strokeWidth=".8" /></svg>
            </BarButton>
            <BarButton label="Eraser" shortcut="⇧⌫" active={erasing} onPress={() => setBoardTool("eraser", "draw")}>
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="2" width="10" height="17" rx="2.5" fill="#F2A8A8" stroke="#D88A8A" /><rect x="5" y="2" width="10" height="6" rx="2.5" fill="#FBD3D3" /></svg>
            </BarButton>
            <Rule />
            {sizes.map((s, i) => (
                <BarButton key={s} label={i === 0 ? "Thin" : "Thick"} disabled={erasing || tool === "washi"} active={!erasing && tool !== "washi" && size === s} onPress={() => board.set(hl ? { highlighterSize: s } : { markerSize: s })}>
                    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M2 9 C5 1 7 1 9 6 S13 11 16 3" fill="none" stroke={hl ? current : "#1E1E1E"} strokeOpacity={hl ? 1 : 0.55} strokeWidth={i === 0 ? 1.4 : 3.2} strokeLinecap="round" /></svg>
                </BarButton>
            ))}
            <Rule />
            {tool === "washi" ? (
                <>
                    {WASHI_PATTERNS.filter((w) => w.pattern !== "plain").map((w) => (
                        <button key={w.pattern} type="button" aria-label={w.label} title={w.label} aria-pressed={b.washi === w.pattern} onClick={() => board.set({ washi: w.pattern })} className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] ${b.washi === w.pattern ? "bg-[#9747FF]/35" : "hover:bg-black/5"}`}>
                            <WashiSwatch pattern={w.pattern} color={w.color} />
                        </button>
                    ))}
                    {b.washiImage ? (
                        <button type="button" aria-label="Your pattern" title="Your pattern" aria-pressed={b.washi === "custom"} onClick={() => board.set({ washi: "custom" })} className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] ${b.washi === "custom" ? "bg-[#9747FF]/35" : "hover:bg-black/5"}`}>
                            <span className="size-4 rounded-full border border-black/10 bg-cover bg-center" style={{ backgroundImage: `url(${imageSrc({ pattern: b.washiImage.data }, "pattern") ?? ""})` }} />
                        </button>
                    ) : (
                        <button type="button" aria-label="Plain" title="Plain" aria-pressed={b.washi === "plain"} onClick={() => board.set({ washi: "plain" })} className={`flex size-8 shrink-0 items-center justify-center rounded-[5px] ${b.washi === "plain" ? "bg-[#9747FF]/35" : "hover:bg-black/5"}`}>
                            <WashiSwatch pattern="plain" color="#F4E3B5" />
                        </button>
                    )}
                    <label title="Upload a pattern" className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[5px] hover:bg-black/5">
                        <Plus className="size-4" />
                        <input
                            type="file"
                            accept="image/*"
                            aria-label="Upload a washi tape pattern"
                            className="sr-only"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                const image = file ? await readImage(file) : null;
                                if (image) board.set({ washiImage: { id: image.id, data: image.data }, washi: "custom" });
                                else if (file) editor.notify("That file isn't an image.");
                            }}
                        />
                    </label>
                </>
            ) : (
                <>
                    {colors.map((c) => (
                        <Swatch key={c.color} color={c.color} label={c.name} disabled={erasing} active={!erasing && current === c.color} onPress={() => pick(c.color)} />
                    ))}
                    <ColorPicker value={current} onPick={pick} disabled={erasing} />
                </>
            )}
        </div>
    );
}

// The sticky bar: the ten colours (326 wide). Square or wide is the sticky's own (its selection bar,
// and ⇧ while placing); the wide default stays in the board's View menu.
const STICKY_ORDER = ["#FFFFFF", "#E6E6E6", "#FFB8A8", "#FFD3A8", "#FFE299", "#B3EFBD", "#B3F4EF", "#A8DAFF", "#D3BDFF", "#FFA8DB"];
function StickyTray() {
    const color = useBoard((s) => s.stickyColor);
    const colors = STICKY_ORDER.map((c) => STICKY_COLORS.find((k) => k.color === c)).filter((c): c is { name: string; color: string } => Boolean(c));
    return (
        <div className={`${bar} w-[326px] px-[3px]`} role="toolbar" aria-label="Sticky notes">
            {colors.map((c) => (
                <Swatch key={c.color} color={c.color} label={c.name} active={color === c.color} onPress={() => board.set({ stickyColor: c.color, tool: "sticky", tray: "sticky" })} />
            ))}
        </div>
    );
}

// The four connectors: bent, curved, straight with an arrow, and a plain line without endpoints.
type LineChoice = { id: string; line: ConnectorLine; plain?: boolean; label: string; shortcut?: string };
const LINES: LineChoice[] = [
    { id: "elbow", line: "elbow", label: "Bent connector", shortcut: "X" },
    { id: "curved", line: "curved", label: "Curved connector" },
    { id: "straight", line: "straight", label: "Connector", shortcut: "⇧L" },
    { id: "plain", line: "straight", plain: true, label: "Connector, no endpoints" },
];

function pickLine(l: LineChoice) {
    const style = board.get().connectorStyle;
    const ends = l.plain ? { startCap: "none" as const, endCap: "none" as const } : style.endCap === "none" && style.startCap === "none" ? { endCap: "arrow" as const } : {};
    board.set({ tool: "connector", connectorLine: l.line, tray: "shape", connectorStyle: { ...style, ...ends } });
}

function lineActive(l: LineChoice, b: { tool: BoardTool | null; connectorLine: ConnectorLine; connectorStyle: { startCap: string; endCap: string } }) {
    if (b.tool !== "connector" || b.connectorLine !== l.line) return false;
    const plain = b.connectorStyle.endCap === "none" && b.connectorStyle.startCap === "none";
    return l.line !== "straight" || Boolean(l.plain) === plain;
}

function MindMapGlyph() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1.5" y="7.5" width="6" height="5" rx="1" />
            <rect x="12.5" y="2.5" width="6" height="4.5" rx="1" />
            <rect x="12.5" y="13" width="6" height="4.5" rx="1" />
            <path d="M7.5 10 H10 V4.75 H12.5 M10 10 V15.25 H12.5" />
        </svg>
    );
}

// Shapes and connectors, 549 wide: the new shapes' colour, the four connectors, seven shapes and a
// mind map, and More shapes.
function ShapeTray() {
    const b = useBoard((s) => s);
    return (
        <div className={`${bar} w-[549px]`} role="toolbar" aria-label="Shapes and connectors">
            <ShapeColor />
            <Rule />
            {LINES.map((l) => (
                <BarButton key={l.id} label={l.label} shortcut={l.shortcut} active={lineActive(l, b)} onPress={() => pickLine(l)}>
                    <ConnectorGlyph line={l.plain ? "plain" : l.line} />
                </BarButton>
            ))}
            {TRAY_SHAPES.map((shape) => (
                <BarButton key={shape} label={SHAPE_LABELS[shape]} shortcut={shape === "square" ? "R" : shape === "ellipse" ? "O" : undefined} active={b.tool === "shape" && b.shape === shape} onPress={() => board.set({ tool: "shape", shape, tray: "shape" })}>
                    <ShapeGlyph shape={shape} />
                </BarButton>
            ))}
            <BarButton label="Mind map" onPress={() => { board.set({ tray: null, tool: null }); insertMindMap("boxes"); }}>
                <MindMapGlyph />
            </BarButton>
            <Rule />
            <button type="button" aria-pressed={b.shapesPanel} onClick={() => board.set({ shapesPanel: !b.shapesPanel })} className={`h-6 shrink-0 whitespace-nowrap rounded-[5px] border border-black/10 px-[7px] text-[11px] ${b.shapesPanel ? "bg-black/10" : "hover:bg-black/5"}`}>
                More shapes
            </button>
        </div>
    );
}

// The colour new shapes get.
function ShapeColor() {
    const color = useBoard((s) => s.shapeColor);
    const [open, setOpen] = useState(false);
    return (
        <span className="relative flex">
            <Tip label="Color" below gap={7}>
                <button type="button" aria-label="Shape colour" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-8 w-11 items-center justify-center gap-1 rounded-[5px] hover:bg-black/5">
                    <span className="size-4 rounded-full border border-black/30" style={{ background: color }} />
                    <ChevronDown className="size-3 text-black/60" />
                </button>
            </Tip>
            {open && (
                <div className="absolute bottom-full left-0 mb-3 grid gap-1.5 rounded-xl bg-white p-2.5 shadow-[0_2px_14px_rgba(0,0,0,0.18)]" style={{ gridTemplateColumns: "repeat(11, 1.5rem)" }}>
                    {SHAPE_COLORS.map((c) => (
                        <button key={c.color} type="button" aria-label={c.name} title={c.name} onClick={() => { board.set({ shapeColor: c.color, tool: "shape", tray: "shape" }); setOpen(false); }} className={`size-6 rounded-full border border-black/15 ${color === c.color ? "ring-2 ring-[#9747FF] ring-offset-2" : "hover:scale-110"}`} style={{ background: c.color }} />
                    ))}
                </div>
            )}
        </span>
    );
}

// The Actions panel over the toolbar (its width): a search and the board's AI and making actions,
// in groups, with "All actions" for the full command palette.
type ActionRow = { id: string; group: string; label: string; icon: ReactNode; ai?: boolean; run: () => void };
const ACTION_ROWS: ActionRow[] = [
    { id: "summarize", group: "Organize", label: "Summarize stickies", ai: true, icon: <List className="size-4" />, run: () => void summarizeSelection() },
    { id: "sort", group: "Organize", label: "Sort stickies by topic", icon: <LayoutGrid01 className="size-4" />, run: () => void sortStickies() },
    { id: "templates", group: "Templates and diagrams", label: "Browse templates and diagrams…", icon: <LayoutGrid01 className="size-4" />, run: () => board.set({ templatesOpen: true }) },
    { id: "ideas", group: "Templates and diagrams", label: "Make new mind map ideas", ai: true, icon: <MindMapGlyph />, run: () => void generateIdeas() },
    { id: "mindmap", group: "Templates and diagrams", label: "New mind map", icon: <MindMapGlyph />, run: () => insertMindMap("boxes") },
    { id: "image", group: "Images", label: "Add an image or video…", icon: <Image01 className="size-4" />, run: () => pickImages(viewCenter) },
    { id: "all", group: "More", label: "All actions…", icon: <Stars02 className="size-4" />, run: () => editor.set({ actionsOpen: true }) },
];

function ActionsTray() {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const rows = ACTION_ROWS.filter((r) => !q || r.label.toLowerCase().includes(q));
    const groups = [...new Set(rows.map((r) => r.group))];
    return (
        <div className="pointer-events-auto flex h-[353px] w-[586px] flex-col rounded-[13px] bg-white p-2 text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]" role="dialog" aria-label="Actions">
            <label className="flex h-8 shrink-0 items-center gap-2 rounded-[5px] bg-[#F0F0F0] px-2">
                <SearchSm className="size-4 text-black/50" />
                <input autoFocus aria-label="Search actions" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && board.set({ tray: null })} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/40" />
            </label>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto" role="menu">
                {!rows.length && <p className="px-2 py-2 text-[13px] text-black/50">No actions match “{query.trim()}”.</p>}
                {groups.map((g) => (
                    <div key={g} className="mb-1.5">
                        <div className="flex h-6 items-center px-2 text-[11px] text-black/50">{g}</div>
                        {rows.filter((r) => r.group === g).map((r) => (
                            <button key={r.id} type="button" role="menuitem" onClick={() => { board.set({ tray: null }); r.run(); }} className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] hover:bg-[#F0F0F0]">
                                <span className="flex size-4 items-center justify-center">{r.icon}</span>
                                <span className="flex-1">{r.label}</span>
                                {r.ai && <span className="rounded-[3px] border border-black/10 px-1 text-[9px] font-medium leading-[14px] text-black/50">AI</span>}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// The "+" panel's widgets (with what was used lately at the top).
const WIDGETS: { id: string; label: string; run: () => void }[] = [
    { id: "timer", label: "Timer and music", run: () => board.set({ meetings: "timer" }) },
    { id: "voting", label: "Voting session", run: () => board.set({ meetings: "voting" }) },
    { id: "code", label: "Code block", run: () => setBoardTool("code") },
    { id: "table", label: "Table", run: () => setBoardTool("table") },
    { id: "mindmap", label: "Mind map", run: () => insertMindMap("boxes") },
    { id: "link", label: "Link preview", run: () => void askText("Link preview", "https://").then((v) => { const url = linkFrom(v ?? ""); if (url) placeLink(viewCenter(), url); }) },
    { id: "templates", label: "Templates", run: () => board.set({ templatesOpen: true }) },
    { id: "poll", label: "Poll", run: () => placeWidget(viewCenter(), "poll") },
    { id: "checklist", label: "Checklist", run: () => placeWidget(viewCenter(), "checklist") },
    { id: "counter", label: "Counter", run: () => placeWidget(viewCenter(), "counter") },
];

// What the old Insert menu offered, now the first group of the "+" panel's All tab.
const INSERTS: { id: string; label: string; run: () => void }[] = [
    { id: "image", label: "Image or video…", run: () => pickImages(viewCenter) },
    { id: "table", label: "Table", run: () => setBoardTool("table") },
    { id: "code", label: "Code block", run: () => setBoardTool("code") },
    { id: "link", label: "Link preview…", run: () => void askText("Link preview", "https://").then((v) => { const url = linkFrom(v ?? ""); if (url) placeLink(viewCenter(), url); }) },
    { id: "timer", label: "Timer", run: () => board.set({ meetings: "timer" }) },
    { id: "voting", label: "Voting session", run: () => board.set({ meetings: "voting" }) },
];

function use(id: string, run: () => void) {
    board.set({ tray: null, recent: [id, ...board.get().recent.filter((r) => r !== id)].slice(0, 4) });
    run();
}

// The "+" panel, 480×615 over the toolbar's "+": a search with a focus ring, tabs All / Stickers /
// Templates / Widgets / Plugins / More (faces, what your teams published, and plugin import).
type MoreTab = "all" | "stickers" | "templates" | "widgets" | "plugins" | "more";
const MORE_TABS: { tab: MoreTab; label: string }[] = [
    { tab: "all", label: "All" },
    { tab: "stickers", label: "Stickers" },
    { tab: "templates", label: "Templates" },
    { tab: "widgets", label: "Widgets" },
    { tab: "plugins", label: "Plugins" },
    { tab: "more", label: "More" },
];

const tile = "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg bg-[#F5F5F5] p-1 text-center text-[10px] leading-3 hover:bg-[#EBEBEB]";
const rowItem = "flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] hover:bg-black/5";
const heading = "mb-2 mt-1 text-[12px] font-semibold";

function MoreTray() {
    const [tab, setTab] = useState<MoreTab>("all");
    const [query, setQuery] = useState("");
    const recent = useBoard((s) => s.recent);
    const plugins = usePlugins((s) => s.plugins);
    const peers = useCollab((s) => s.peers);
    const me = useCollab((s) => s.me);
    const teams = useTeams();
    const [published, setPublished] = useState<{ teamId: string; template: TeamTemplate }[] | null>(null);
    useEffect(() => {
        if (tab === "plugins" || tab === "all") void loadPlugins();
        if (tab !== "more" || published) return;
        void Promise.all(teams.map((t) => loadTeamTemplates(t.id).then((list) => list.map((template) => ({ teamId: t.id, template }))).catch(() => []))).then((all) => setPublished(all.flat()));
    }, [tab, teams, published]);
    const q = query.trim().toLowerCase();
    const has = (text: string) => !q || text.toLowerCase().includes(q);
    const recentWidgets = recent.map((r) => WIDGETS.find((w) => w.id === r)).filter((w): w is (typeof WIDGETS)[number] => Boolean(w));
    const recentStickers = recent.filter((r) => r.startsWith("sticker:")).map((r) => r.slice(8));
    const boardPlugins = plugins.filter((p) => !isCodegen(p));
    const faces = [{ name: me.name || "You", color: me.color }, ...Object.values(peers).map((p) => ({ name: p.name, color: p.color }))].filter((f, i, all) => all.findIndex((g) => g.name === f.name) === i);
    const sticker = (g: string) => (
        <button key={g} type="button" aria-label={`Sticker ${g}`} onClick={() => use(`sticker:${g}`, () => { board.set({ sticker: g }); setBoardTool("sticker"); })} className="flex aspect-square w-full items-center justify-center rounded-lg bg-[#F5F5F5] text-[34px] hover:bg-[#EBEBEB]">{g}</button>
    );
    const searching = q.length > 0;
    const show = (t: MoreTab) => searching || tab === "all" || tab === t;
    const templates = BOARD_TEMPLATES.filter((t) => has(`${t.name} ${t.category}`));
    const widgets = WIDGETS.filter((w) => has(w.label));
    const inserts = INSERTS.filter((i) => has(i.label));
    const shownPlugins = boardPlugins.filter((p) => has(p.manifest.name));
    const community = (published ?? []).filter(({ template }) => has(template.name));
    const nothing = searching && !templates.length && !widgets.length && !inserts.length && !shownPlugins.length && !community.length;
    return (
        <div className="pointer-events-auto flex h-[615px] max-h-[calc(100vh-140px)] w-[480px] flex-col rounded-[13px] bg-white text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_5px_14px_rgba(0,0,0,0.1)]" role="dialog" aria-label="Widgets, stickers, templates and more">
            <div className="flex items-center gap-3 px-5 pt-5">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] border-2 border-[#9747FF] px-3">
                    <SearchSm className="size-3.5 text-black/50" />
                    <input autoFocus aria-label="Search templates, widgets, plugins and stickers" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && board.set({ tray: null })} placeholder="Try typing “retro”" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/40" />
                </label>
                <button type="button" aria-label="Close" onClick={() => board.set({ tray: null })} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5"><X className="size-4" /></button>
            </div>
            <div className="flex h-12 shrink-0 items-center gap-1 border-b border-black/10 px-5">
                {MORE_TABS.map((t) => (
                    <button key={t.tab} type="button" aria-pressed={tab === t.tab && !searching} onClick={() => { setTab(t.tab); setQuery(""); }} className={`h-6 rounded-[5px] px-2 text-[11px] ${tab === t.tab && !searching ? "bg-[#F0F0F0] font-semibold" : "text-black/60 hover:bg-black/5"}`}>{t.label}</button>
                ))}
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {nothing && <p className="text-[12px] text-black/50">Nothing matches “{query.trim()}”.</p>}
                {!searching && tab === "all" && (recentWidgets.length > 0 || recentStickers.length > 0) && (
                    <section>
                        <h3 className={heading}>Recently used</h3>
                        <div className="flex flex-wrap gap-2">
                            {recentWidgets.map((w) => (
                                <button key={w.id} type="button" onClick={() => use(w.id, w.run)} className="h-7 rounded-[5px] bg-[#F5F5F5] px-2.5 text-[11px] hover:bg-[#EBEBEB]">{w.label}</button>
                            ))}
                            {recentStickers.map((g) => (
                                <button key={g} type="button" aria-label={`Sticker ${g}`} onClick={() => use(`sticker:${g}`, () => { board.set({ sticker: g }); setBoardTool("sticker"); })} className="flex size-7 items-center justify-center rounded-[5px] text-[17px] hover:bg-black/5">{g}</button>
                            ))}
                        </div>
                    </section>
                )}
                {(searching || tab === "all" || tab === "more") && inserts.length > 0 && (
                    <section role="menu" aria-label="Insert">
                        <h3 className={heading}>Insert</h3>
                        <div className="grid grid-cols-5 gap-4">
                            {inserts.map((i) => (
                                <button key={i.id} type="button" role="menuitem" onClick={() => use(i.id, i.run)} className={tile}>{i.label}</button>
                            ))}
                        </div>
                    </section>
                )}
                {show("stickers") && !searching && (
                    <section>
                        {tab === "all" && <h3 className={heading}>Stickers</h3>}
                        <div className="grid grid-cols-5 gap-4">{(tab === "all" ? STICKERS.slice(0, 10) : STICKERS).map(sticker)}</div>
                    </section>
                )}
                {show("templates") && templates.length > 0 && (
                    <section role="menu" aria-label="Templates">
                        {(tab === "all" || searching) && <h3 className={heading}>Templates</h3>}
                        <div className="grid grid-cols-2 gap-4">
                            {(tab === "all" && !searching ? templates.slice(0, 4) : templates).map((t) => (
                                <button key={t.id} type="button" role="menuitem" onClick={() => use(`template:${t.id}`, () => insertTemplate(t))} className="flex flex-col gap-1 text-left">
                                    <span className="flex h-[104px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#F5F5F5] hover:bg-[#EBEBEB]">
                                        {t.colors.slice(0, 4).map((c, i) => <span key={`${c}${i}`} className="size-7 rounded-sm shadow-sm" style={{ background: c }} />)}
                                    </span>
                                    <span className="text-[12px] font-medium">{t.name}</span>
                                    <span className="text-[11px] text-black/50">{t.category}</span>
                                </button>
                            ))}
                        </div>
                        {!searching && <button type="button" onClick={() => use("templates", () => board.set({ templatesOpen: true }))} className={`${rowItem} mt-2`}>Browse all templates…</button>}
                    </section>
                )}
                {show("widgets") && widgets.length > 0 && (
                    <section role="menu" aria-label="Widgets">
                        {(tab === "all" || searching) && <h3 className={heading}>Widgets</h3>}
                        <div className="grid grid-cols-5 gap-4">
                            {widgets.map((w) => (
                                <button key={w.id} type="button" role="menuitem" onClick={() => use(w.id, w.run)} className={tile}>{w.label}</button>
                            ))}
                        </div>
                    </section>
                )}
                {show("plugins") && (shownPlugins.length > 0 || (!searching && tab === "plugins")) && (
                    <section role="menu" aria-label="Plugins">
                        {(tab === "all" || searching) && <h3 className={heading}>Plugins</h3>}
                        {shownPlugins.map((p) => (
                            <button key={p.id} type="button" role="menuitem" className={rowItem} onClick={() => use(`plugin:${p.id}`, () => runPlugin(p.id))}>{p.manifest.name}</button>
                        ))}
                        {!searching && tab === "plugins" && !boardPlugins.length && <p className="px-2 py-1.5 text-[12px] text-black/50">No plugins yet.</p>}
                        {!searching && tab === "plugins" && <button type="button" role="menuitem" className={rowItem} onClick={() => { board.set({ tray: null }); pickPluginManifest(); }}>Import plugin from manifest…</button>}
                    </section>
                )}
                {tab === "more" && !searching && (
                    <section>
                        <h3 className={heading}>Faces</h3>
                        <div className="flex flex-wrap gap-2">
                            {faces.map((f) => (
                                <button key={f.name} type="button" title={f.name} aria-label={`Face: ${f.name}`} onClick={() => { board.set({ tray: null }); pickStamp({ kind: "face", face: f }); }} className="flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-black/5">
                                    <span className="flex size-10 items-center justify-center rounded-full border-2 border-white text-[14px] font-bold text-white shadow" style={{ background: f.color }}>{stampLook({ kind: "face", face: f }).glyph}</span>
                                    <span className="max-w-14 truncate text-[10.5px]">{f.name}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                )}
                {((tab === "more" && !searching) || (searching && community.length > 0)) && (
                    <section role="menu" aria-label="From your teams">
                        <h3 className={heading}>From your teams</h3>
                        {community.map(({ teamId, template }) => (
                            <button key={template.id} type="button" role="menuitem" className={rowItem} onClick={() => { board.set({ tray: null }); void startFromTemplate(teamId, template); }}>{template.name}<span className="ml-auto text-[11px] text-black/40">{template.kind}</span></button>
                        ))}
                        {!searching && published !== null && !published.length && <p className="px-2 py-1.5 text-[12px] text-black/50">{teams.length ? "Nothing published by your teams yet." : "Join a team to see what it publishes."}</p>}
                        {!searching && published === null && <p className="px-2 py-1.5 text-[12px] text-black/50">Loading…</p>}
                    </section>
                )}
            </div>
        </div>
    );
}

export function ShapesPanel() {
    const open = useBoard((s) => s.shapesPanel);
    const current = useBoard((s) => (s.tool === "shape" ? s.shape : null));
    const b = useBoard((s) => s);
    const [query, setQuery] = useState("");
    if (!open) return null;
    const match = (k: ShapeKind) => SHAPE_LABELS[k].toLowerCase().includes(query.toLowerCase());
    const pick = (shape: ShapeKind) => board.set({ tool: "shape", shape, tray: "shape" });
    const grid = (list: ShapeKind[]) => (
        <div className="grid grid-cols-5 gap-1">
            {list.filter(match).map((shape) => (
                <button key={shape} type="button" aria-label={SHAPE_LABELS[shape]} title={SHAPE_LABELS[shape]} onClick={() => pick(shape)} className={`flex aspect-square items-center justify-center rounded-md ${current === shape ? "bg-[#9747FF]/15 text-[#9747FF]" : "hover:bg-black/5"}`}>
                    <ShapeGlyph shape={shape} size={24} />
                </button>
            ))}
        </div>
    );
    return (
        <aside className="pointer-events-auto absolute left-3 top-16 bottom-20 z-10 flex w-64 flex-col overflow-hidden rounded-xl bg-white text-[#1E1E1E] shadow-[0_2px_14px_rgba(0,0,0,0.16)]" aria-label="Shapes">
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <span className="text-[13px] font-semibold">Shapes</span>
                <button type="button" aria-label="Close shapes" onClick={() => board.set({ shapesPanel: false })} className="rounded p-1 hover:bg-black/5"><X className="size-4" /></button>
            </div>
            <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md bg-black/5 px-2">
                <SearchSm className="size-3.5 text-black/50" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shapes" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
            </label>
            <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3 text-[11px]">
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Connectors</h3>
                    <div className="grid grid-cols-5 gap-1">
                        {LINES.filter((l) => l.label.toLowerCase().includes(query.toLowerCase()) || !query).map((l) => (
                            <button key={l.id} type="button" aria-label={l.label} title={l.label} aria-pressed={lineActive(l, b)} onClick={() => pickLine(l)} className="flex aspect-square items-center justify-center rounded-md hover:bg-black/5">
                                <ConnectorGlyph line={l.plain ? "plain" : l.line} />
                            </button>
                        ))}
                    </div>
                </section>
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Mind maps</h3>
                    <div className="grid grid-cols-3 gap-1">
                        {MIND_MAP_STYLES.filter((m) => !query || `mind map ${m.label}`.toLowerCase().includes(query.toLowerCase())).map((m) => (
                            <button key={m.style} type="button" title={`${m.label} mind map`} onClick={() => insertMindMap(m.style)} className="flex flex-col items-center gap-1 rounded-md p-1.5 hover:bg-black/5">
                                <svg width="56" height="32" viewBox="0 0 56 32" aria-hidden="true">
                                    <path d="M22 16 C 30 16 30 7 36 7 M22 16 C 30 16 30 25 36 25 M34 16 C 26 16 26 7 20 7" fill="none" stroke="#757575" strokeWidth="1.2" />
                                    <rect x="20" y="11" width="16" height="10" rx={m.style === "stickies" ? 1 : 3} fill={m.colors[0]} stroke={m.style === "simple" ? "#1E1E1E" : "none"} />
                                    <rect x="38" y="3" width="14" height="8" rx={m.style === "stickies" ? 1 : 3} fill={m.colors[1]} stroke={m.style === "simple" ? "#B3B3B3" : "none"} />
                                    <rect x="38" y="21" width="14" height="8" rx={m.style === "stickies" ? 1 : 3} fill={m.colors[2]} stroke={m.style === "simple" ? "#B3B3B3" : "none"} />
                                    <rect x="4" y="3" width="14" height="8" rx={m.style === "stickies" ? 1 : 3} fill={m.colors[1]} stroke={m.style === "simple" ? "#B3B3B3" : "none"} />
                                </svg>
                                <span className="text-[10.5px]">{m.label}</span>
                            </button>
                        ))}
                    </div>
                </section>
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Basic</h3>
                    {grid(BASIC_SHAPES)}
                </section>
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Flowchart</h3>
                    {grid(FLOWCHART_SHAPES)}
                </section>
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Advanced</h3>
                    {grid(ADVANCED_SHAPES)}
                </section>
                <section>
                    <h3 className="mb-1 font-semibold text-black/60">Cloud architecture</h3>
                    {grid(CLOUD_SHAPES)}
                </section>
            </div>
        </aside>
    );
}

// Dragging the sticky stack or the shapes button onto the board drops one where it's let go.
export const TOOL_DRAG = "application/x-nagma-board-tool";
function dragTool(event: React.DragEvent, tool: "sticky" | "shape") {
    event.dataTransfer.setData(TOOL_DRAG, tool);
    event.dataTransfer.effectAllowed = "copy";
}

// The toolbar's drawn tools: a marker standing in the bar (lifted while in hand) and a pad of
// stickies in the current colour; both run off the toolbar's bottom edge.
function PenArt({ color, active, tool }: { color: string; active: boolean; tool: string }) {
    const body = tool === "eraser" ? "#F2A8A8" : tool === "washi" ? "#EFE4FF" : "#FFFFFF";
    const tip = tool === "highlighter" ? "#FFE15A" : color;
    return (
        <svg width="28" height="44" viewBox="0 0 28 44" aria-hidden="true" style={{ transform: active ? "translateY(-5px)" : "translateY(2px)", transition: "transform 120ms" }}>
            <path d="M5 44 L5 18 L11 5 Q14 1.5 17 5 L23 18 L23 44 Z" fill={body} stroke="#C8C8C8" strokeWidth="1" />
            {tool === "eraser" ? <rect x="5" y="14" width="18" height="8" fill="#FBD3D3" /> : <path d="M11.2 9.5 L14 3.2 L16.8 9.5 Z" fill={tip} />}
            <path d="M5 18 L23 18" stroke="#DADADA" strokeWidth="1" />
        </svg>
    );
}

function StickyPadArt({ color, active }: { color: string; active: boolean }) {
    return (
        <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden="true" style={{ transform: active ? "translateY(-4px)" : "translateY(3px)", transition: "transform 120ms" }}>
            <path d="M10 12 Q10 9 13 9 L44 7 Q47 7 47 10 L48 44 L9 44 Z" fill={color} opacity="0.55" />
            <path d="M6 15 Q6 12 9 12 L43 12 Q46 12 46 15 L46 44 L6 44 Z" fill={color} />
            <path d="M6 15 Q6 12 9 12 L43 12 Q46 12 46 15 L46 17 L6 17 Z" fill="rgba(255,255,255,0.35)" />
        </svg>
    );
}

export function BoardToolbar() {
    const b = useBoard((s) => s);
    const tool = useEditor((s) => s.tool);
    const readOnly = useEditor((s) => s.readOnly);
    const editorTool = (t: Tool) => {
        setBoardTool(null);
        editor.set({ tool: t });
    };
    const isDraw = b.tool !== null && DRAW_TOOLS.includes(b.tool);
    const toggleTray = (t: NonNullable<typeof b.tray>, start: BoardTool | null) => {
        if (b.tray === t && (start === null || b.tool === start || (t === "draw" && isDraw))) return board.set({ tray: null, tool: null });
        board.set({ tray: t, tool: start });
        if (start) editor.set({ tool: "move" });
    };
    // Square and Connector are two targets on one drawn button; each opens the shapes bar.
    const shapeTool = (start: "shape" | "connector") => {
        if (b.tray === "shape" && b.tool === start) return board.set({ tray: null, tool: null });
        if (start === "shape") board.set({ shape: "square" });
        board.set({ tray: "shape", tool: start });
        editor.set({ tool: "move" });
    };
    if (readOnly) {
        return (
            <div className="pointer-events-auto flex h-12 items-center gap-2 rounded-[13px] bg-white px-2 shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]">
                <ToolButton label="Select tool" shortcut="V" active={!b.tool && tool === "move"} onPress={() => editorTool("move")}><Cursor01 className="size-5" /></ToolButton>
                <ToolButton label="Hand tool" shortcut="H" active={tool === "hand"} onPress={() => editorTool("hand")}><Hand className="size-5" /></ToolButton>
                <ToolButton label="Comment" shortcut="C" active={tool === "comment"} onPress={() => editorTool("comment")}><MessageCircle01 className="size-5" /></ToolButton>
            </div>
        );
    }
    const drawName = DRAW_NAMES[isDraw && b.tool ? b.tool : "marker"] ?? "Marker";
    // While you're voting, votes are stamps: the Stamp tool shows as the one in hand.
    const voting = amVoting();
    return (
        <div className="flex flex-col items-center">
            {b.tray === "draw" && <div className="mb-[9px]"><DrawTray /></div>}
            {b.tray === "sticky" && <div className="mb-[9px]"><StickyTray /></div>}
            {b.tray === "shape" && <div className="mb-[9px]"><ShapeTray /></div>}
            {b.tray === "actions" && <div className="mb-[9px]"><ActionsTray /></div>}
            <div className="relative">
                {b.tray === "more" && <div className="absolute bottom-full right-[-216px] mb-1.5"><MoreTray /></div>}
                <div className="pointer-events-auto flex h-12 w-[586px] items-center rounded-[13px] bg-white px-2 shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]" role="toolbar" aria-label="Board tools">
                    <div className="flex items-center gap-2">
                        <ToolButton label="Select tool" shortcut="V" active={!b.tool && tool === "move" && !voting} onPress={() => editorTool("move")}><Cursor01 className="size-5" /></ToolButton>
                        <ToolButton label="Hand tool" shortcut="H" active={!b.tool && tool === "hand"} onPress={() => editorTool("hand")}><Hand className="size-5" /></ToolButton>
                    </div>
                    <span className="ml-2 h-12 w-px shrink-0 bg-black/[0.08]" />
                    <div className="flex h-12 w-[208px] shrink-0 items-end overflow-hidden pl-[7px]">
                        <Tip label={drawName} shortcut={drawName === "Marker" ? "M" : drawName === "Highlighter" ? "⇧M" : drawName === "Washi tape" ? "W" : "⇧⌫"} gap={3}>
                            <button type="button" aria-label="Drawing tools" aria-pressed={isDraw} onClick={() => toggleTray("draw", isDraw ? b.tool : "marker")} className="flex h-12 w-12 items-end justify-center overflow-hidden outline-none">
                                <PenArt color={b.drawColor} active={isDraw} tool={isDraw && b.tool ? b.tool : "marker"} />
                            </button>
                        </Tip>
                        <span className="w-2 shrink-0" />
                        <Tip label="Sticky note" shortcut="S" gap={3}>
                            <button type="button" draggable onDragStart={(e) => dragTool(e, "sticky")} aria-label="Sticky note" aria-pressed={b.tool === "sticky"} onClick={() => toggleTray("sticky", "sticky")} className="flex h-12 w-16 items-end justify-center overflow-hidden outline-none">
                                <StickyPadArt color={b.stickyColor} active={b.tool === "sticky"} />
                            </button>
                        </Tip>
                        <span className="w-[11px] shrink-0" />
                        <div className={`flex h-12 w-[60px] shrink-0 items-center ${b.tray === "shape" ? "" : ""}`}>
                            <Tip label="Square" shortcut="R">
                                <button type="button" draggable onDragStart={(e) => dragTool(e, "shape")} aria-label="Square" aria-pressed={b.tool === "shape"} onClick={() => shapeTool("shape")} className={`flex size-8 items-center justify-center rounded-[5px] outline-none ${b.tool === "shape" ? "bg-black/5" : "hover:bg-black/5"}`}>
                                    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="2.5" y="2.5" width="17" height="17" rx="1" fill="#FFFFFF" stroke="#757575" strokeWidth="1.2" /></svg>
                                </button>
                            </Tip>
                            <Tip label="Connector" shortcut="X" gap={3}>
                                <button type="button" aria-label="Connector" aria-pressed={b.tool === "connector"} onClick={() => shapeTool("connector")} className={`flex h-12 w-7 flex-col items-center justify-between rounded-[5px] pt-[9px] outline-none ${b.tool === "connector" ? "bg-black/5" : "hover:bg-black/5"}`}>
                                    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M2 13 V8 Q2 5 5 5 H15" fill="none" stroke="#757575" strokeWidth="1.3" strokeLinecap="round" /><path d="M12 2 L15.5 5 L12 8" fill="none" stroke="#757575" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="#FFFFFF" stroke="#757575" strokeWidth="1.2" /></svg>
                                </button>
                            </Tip>
                        </div>
                    </div>
                    <span className="h-12 w-px shrink-0 bg-black/[0.08]" />
                    <div className="ml-2 flex items-center gap-2">
                        <ToolButton label="Text" shortcut="T" active={!b.tool && tool === "text"} onPress={() => editorTool("text")}><Type01 className="size-5" /></ToolButton>
                        <ToolButton label="Section" shortcut="⇧S" active={!b.tool && tool === "section"} onPress={() => editorTool("section")}><SectionGlyph /></ToolButton>
                        <ToolButton label="Table" shortcut="⇧T" active={b.tool === "table"} onPress={() => setBoardTool(b.tool === "table" ? null : "table")}><Table className="size-5" /></ToolButton>
                        <ToolButton label="Stamp" shortcut="E" active={b.tool === "stamp" || Boolean(b.wheel) || voting} onPress={() => (b.tool === "stamp" ? board.set({ tool: null }) : openWheel())}>
                            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><circle cx="10" cy="5.5" r="3" /><path d="M8.6 8.3 L8 12 H4.5 Q3.5 12 3.5 13 V14.5 H16.5 V13 Q16.5 12 15.5 12 H12 L11.4 8.3" /><path d="M5 17 H15" strokeLinecap="round" /></svg>
                        </ToolButton>
                        <ToolButton label="Comment" shortcut="C" active={!b.tool && tool === "comment"} onPress={() => editorTool("comment")}><MessageCircle01 className="size-5" /></ToolButton>
                        <ToolButton label="Actions" shortcut="⌘K" active={b.tray === "actions"} onPress={() => board.set({ tray: b.tray === "actions" ? null : "actions", tool: null })}>
                            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" /><circle cx="14.5" cy="5.5" r="3" /><circle cx="5.5" cy="14.5" r="3" /><path d="M14.5 11.5 V17.5 M11.5 14.5 H17.5" strokeLinecap="round" /></svg>
                        </ToolButton>
                        <ToolButton round wrap label="Widgets, stickers, templates and more" shortcut="⇧I" active={b.tray === "more"} onPress={() => board.set({ tray: b.tray === "more" ? null : "more", tool: null })}><Plus className="size-5" /></ToolButton>
                    </div>
                </div>
            </div>
        </div>
    );
}

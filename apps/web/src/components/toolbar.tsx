import { ArrowUpRight, ChevronDown, Circle, Code01, Cursor01, Hand, ImagePlus, Minus, PenTool01, Pencil01, Ruler, Square, Star01, Triangle, Type01, X, Zap } from "@untitledui/icons";
import { createContext, useContext, useReducer, useState, type ReactNode } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { viewCenter } from "../engine/actions";
import { pickImages } from "../engine/images";
import { openActions, openActionsWith, setMode } from "../engine/modes";
import { type DrawStyle, editor, useEditor } from "../engine/store";
import type { EditorMode, Tool } from "../engine/types";
import { ColorSwatch } from "./color-picker";
import { useCollab } from "../engine/collab";
import { isUnread } from "../engine/comments";
import { MenuRow } from "./left-sidebar";
import { BrushMenu } from "./brush-menu";
import { ActionsIcon, AnnotationIcon, CommentIcon, FrameIcon, DesignModeIcon, MotionModeIcon, DrawBrushIcon, DrawModeIcon, DrawPenIcon, DrawPencilIcon, EyedropperIcon, ScaleIcon, SectionIcon, SliceIcon, TextPathIcon } from "./toolbar-icons";
import { ViewOnlyBanner } from "./collab-ui";

// The floating toolbar, laid out like the reference's: tool groups whose button shows the tool you used
// last, a chevron that opens the rest with the current one ticked, then Actions, and on the right
// the mode switch (Draw, Design, Motion, Inspect). Draw mode swaps in the big pen, brush and
// pencil with a strip of their settings above; Inspect keeps only the tools that look.

type Icon = React.FC<React.SVGProps<SVGSVGElement>>;
export interface ToolDef {
    tool: Tool;
    label: string;
    shortcut?: string;
    icon: Icon;
}
type GroupItem = ToolDef | { action: "place" | "live"; label: string; shortcut?: string; icon: Icon };
export interface Group {
    id: string;
    items: GroupItem[];
}

export const MOVE: Group = { id: "move", items: [{ tool: "move", label: "Move", shortcut: "V", icon: Cursor01 }, { tool: "hand", label: "Hand tool", shortcut: "H", icon: Hand }, { tool: "scale", label: "Scale", shortcut: "K", icon: ScaleIcon }] };
export const FRAME: Group = {
    id: "frame",
    items: [
        { tool: "frame", label: "Frame", shortcut: "F", icon: FrameIcon },
        { tool: "section", label: "Section", shortcut: "⇧S", icon: SectionIcon },
        { tool: "slice", label: "Slice", shortcut: "S", icon: SliceIcon },
        { action: "live", label: "Live frame…", icon: Zap },
    ],
};
export const SHAPES: Group = {
    id: "shape",
    items: [
        { tool: "rect", label: "Rectangle", shortcut: "R", icon: Square },
        { tool: "line", label: "Line", shortcut: "L", icon: Minus },
        { tool: "arrow", label: "Arrow", shortcut: "⇧L", icon: ArrowUpRight },
        { tool: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
        { tool: "polygon", label: "Polygon", icon: Triangle },
        { tool: "star", label: "Star", icon: Star01 },
        { action: "place", label: "Image/video…", shortcut: "⇧⌘K", icon: ImagePlus },
    ],
};
export const FRAME_ONLY: Group = { id: "frame", items: [FRAME.items[0] as ToolDef] };
export const PENS: Group = { id: "pen", items: [{ tool: "pen", label: "Pen", shortcut: "P", icon: PenTool01 }, { tool: "pencil", label: "Pencil", shortcut: "⇧P", icon: Pencil01 }] };
export const TEXT: Group = { id: "text", items: [{ tool: "text", label: "Text", shortcut: "T", icon: Type01 }, { tool: "textpath", label: "Text on path", icon: TextPathIcon }] };
const COMMENT: Group = { id: "comment", items: [{ tool: "comment", label: "Comment", shortcut: "C", icon: CommentIcon }, { tool: "annotation", label: "Annotation", shortcut: "Y", icon: AnnotationIcon }, { tool: "measure", label: "Measurement", shortcut: "⇧M", icon: Ruler }] };
export const COMMENT_ONLY: Group = { id: "comment", items: [COMMENT.items[0] as ToolDef] };

const DRAW_TOOLS: (Omit<ToolDef, "icon"> & { icon: typeof DrawPenIcon })[] = [
    { tool: "pen", label: "Pen", shortcut: "P", icon: DrawPenIcon },
    { tool: "brush", label: "Brush", shortcut: "B", icon: DrawBrushIcon },
    { tool: "pencil", label: "Pencil", shortcut: "⇧P", icon: DrawPencilIcon },
];
const DEV_TOOLS: ToolDef[] = [
    { tool: "move", label: "Move", shortcut: "V", icon: Cursor01 },
    { tool: "eyedropper", label: "Eyedropper", shortcut: "I", icon: EyedropperIcon },
    { tool: "measure", label: "Measurement", shortcut: "⇧M", icon: Ruler },
    { tool: "annotation", label: "Annotation", shortcut: "Y", icon: AnnotationIcon },
    { tool: "comment", label: "Comment", shortcut: "C", icon: CommentIcon },
];

const MODES: { mode: EditorMode; label: string; shortcut?: string; icon: Icon }[] = [
    { mode: "draw", label: "Draw", icon: DrawModeIcon },
    { mode: "design", label: "Design", icon: DesignModeIcon },
    { mode: "motion", label: "Motion", icon: MotionModeIcon },
    { mode: "dev", label: "Inspect", shortcut: "⇧D", icon: Code01 },
];

// Each group remembers the tool you picked last, so its button keeps showing it.
const remembered = new Map<string, Tool>();

// Picks a tool from its group (the slides editor's design toolbar composes the groups too).
export function pickTool(group: Group, def: ToolDef) {
    remembered.set(group.id, def.tool);
    editor.set({ tool: def.tool });
}

// The compact bar (the campaign editor's Design mode): 24px buttons in a 30px bar.
const Compact = createContext(false);
const Unread = createContext(false);

const tip = "rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg";
const DEV_GREEN = "#2F9E60";

// `modes` stands in for the Draw / Design / Motion / Inspect switch (a product's own modes);
// `compact` shrinks the bar to the campaign editor's 30px.
export function Toolbar({ compact = false, modes }: { compact?: boolean; modes?: ReactNode } = {}) {
    const active = useEditor((s) => s.tool);
    const mode = useEditor((s) => s.mode);
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const pick = (group: Group, def: ToolDef) => {
        pickTool(group, def);
        bump();
    };
    const dev = mode === "dev";
    // View access (the banner above): Move, Hand and Comment, then the creation tools greyed out.
    const viewer = useEditor((s) => s.readOnly) && !dev && !compact;
    const groups = mode === "draw" ? [FRAME, SHAPES, TEXT, COMMENT_ONLY] : [MOVE, FRAME, SHAPES, PENS, TEXT, COMMENT];
    // The comment tool's red dot while there are unread comments on this file.
    const unread = useCollab((c) => c.comments.some((t) => !t.resolved && isUnread(t, c.reads)));
    return (
        <Compact.Provider value={compact}>
        <div data-region="toolbar" className="flex flex-col items-center gap-2">
            {mode === "draw" && (active === "pen" || active === "brush" || active === "pencil") && <DrawStrip tool={active} />}
            {!compact && <ViewOnlyBanner />}
            <div className={compact ? "pointer-events-auto flex h-[30px] items-center gap-1 rounded-[8px] bg-panel px-1 shadow-[0_4px_16px_rgba(0,0,0,0.35)]" : "pointer-events-auto flex h-12 items-center rounded-[13px] bg-panel pr-[7px] pl-2 shadow-[0_0_0_0.5px_var(--color-toolbar-ring),0_4px_16px_rgba(0,0,0,0.3)]"}>
                {/* 32pt tools with a 16pt chevron, groups 9 apart (the reference's 528 × 48 bar). */}
                <Unread.Provider value={unread}>
                <div className={`flex items-center ${compact ? "gap-0" : "gap-[9px]"}`}>
                    {dev ? (
                        DEV_TOOLS.map((def) => <ToolButton key={def.tool} def={def} active={active === def.tool} dev onPress={() => editor.set({ tool: def.tool })} />)
                    ) : viewer ? (
                        <ViewerTools active={active} />
                    ) : (
                        <>
                            {mode === "draw" && (
                                <>
                                    <ToolGroup group={MOVE} active={active} onPick={pick} />
                                    <Divider />
                                    {DRAW_TOOLS.map((def) => (
                                        <DrawToolButton key={def.tool} def={def} active={active === def.tool} onPress={() => editor.set({ tool: def.tool })} />
                                    ))}
                                    <Divider />
                                </>
                            )}
                            {groups.map((group) => (
                                <ToolGroup key={group.id} group={group} active={active} onPick={pick} />
                            ))}
                            <ToolButton def={{ tool: "move", label: "Actions", shortcut: "⌘K", icon: ActionsIcon }} active={false} onPress={openActions} />
                        </>
                    )}
                </div>
                </Unread.Provider>
                <Divider tall />
                {modes ?? (
                    // One inset group of the four modes: Draw, Design, Motion, Inspect (28pt buttons in a 122 × 32 well).
                    <div role="radiogroup" aria-label="Mode" className="flex h-8 items-center gap-0.5 rounded-[9px] bg-[var(--color-mode-well)] p-0.5">
                        {MODES.map((m) => (
                            <ModeButton key={m.mode} def={m} active={mode === m.mode} small onPress={() => setMode(m.mode)} />
                        ))}
                    </div>
                )}
            </div>
        </div>
        </Compact.Provider>
    );
}

function ModeButton({ def, active, small, onPress }: { def: (typeof MODES)[number]; active: boolean; small?: boolean; onPress: () => void }) {
    const Icon = def.icon;
    const dev = def.mode === "dev";
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton
                aria-label={def.label}
                aria-pressed={active}
                onPress={onPress}
                style={active && dev ? { color: DEV_GREEN } : undefined}
                className={`flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${small ? "size-7 rounded-[7px]" : "size-8 rounded-md"} ${active ? (small ? `bg-panel shadow-sm ${dev ? "" : "text-brand-500"}` : "bg-brand-500 text-white") : "text-ink-muted hover:text-ink"}`}
            >
                <Icon className="size-[18px]" />
            </AriaButton>
            <AriaTooltip offset={10} className={tip}>
                {def.label}
                {def.shortcut && <span className="ml-2 text-white/50">{def.shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// A viewer's bar: Move, Hand and Comment 8 apart, a full-height rule, then Frame, Shape, Pen, Text
// and Actions greyed out (the reference's view-only bar). ⌘K still opens Actions.
function ViewerTools({ active }: { active: Tool }) {
    const live: ToolDef[] = [MOVE.items[0] as ToolDef, MOVE.items[1] as ToolDef, COMMENT.items[0] as ToolDef];
    const off = (group: Group, chevron: boolean) => <ToolGroup key={group.id} group={chevron ? group : { id: group.id, items: group.items.slice(0, 1) }} active={active} onPick={() => undefined} disabled />;
    return (
        <>
            <div className="flex items-center gap-2">
                {live.map((def) => (
                    <ToolButton key={def.tool} def={def} active={active === def.tool} onPress={() => editor.set({ tool: def.tool })} />
                ))}
            </div>
            <div aria-hidden className="-ml-px h-12 w-px bg-panel-border" />
            {off(FRAME, true)}
            {off(SHAPES, true)}
            {off(PENS, true)}
            {off(TEXT, false)}
            <ToolButton def={{ tool: "move", label: "Actions", shortcut: "⌘K", icon: ActionsIcon }} active={false} disabled onPress={openActions} />
        </>
    );
}

export function Divider({ tall }: { tall?: boolean }) {
    const compact = useContext(Compact);
    if (compact) return <div className="mx-0.5 h-[30px] w-px bg-panel-border" />;
    // The rule before the modes runs the bar's full height.
    return tall ? <div className="mr-[7px] ml-[9px] h-12 w-px bg-panel-border" /> : <div className="mx-1 h-6 w-px bg-panel-border" />;
}

export function ToolButton({ def, active, dev, disabled, onPress }: { def: ToolDef; active: boolean; dev?: boolean; disabled?: boolean; onPress: () => void }) {
    const Icon = def.icon;
    const compact = useContext(Compact);
    const dot = useContext(Unread) && def.tool === "comment";
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton
                aria-label={dot ? `${def.label}, unread comments` : def.label}
                aria-pressed={active}
                onPress={onPress}
                isDisabled={disabled}
                style={active && dev ? { background: DEV_GREEN } : undefined}
                className={`flex shrink-0 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${compact ? "size-6 rounded-[6px]" : "size-8 rounded-md"} ${active ? "bg-brand-500 text-white" : disabled ? "text-ink opacity-50" : "text-ink hover:bg-panel-hover"}`}
            >
                <span className="relative flex">
                    <Icon className={compact ? "size-4" : "size-[18px]"} />
                    {dot && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-[7px] rounded-full bg-[#F24822] ring-[1.5px] ring-panel" />}
                </span>
            </AriaButton>
            <AriaTooltip offset={10} className={tip}>
                {def.label}
                {def.shortcut && <span className="ml-2 text-white/50">{def.shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

export function ToolGroup({ group, active, onPick, disabled }: { group: Group; active: Tool; onPick: (group: Group, def: ToolDef) => void; disabled?: boolean }) {
    const compact = useContext(Compact);
    const tools = group.items.filter((item): item is ToolDef => "tool" in item);
    const inGroup = tools.find((def) => def.tool === active);
    const current = inGroup ?? tools.find((def) => def.tool === remembered.get(group.id)) ?? tools[0];
    if (!current) return null;
    const run = (key: string) => {
        const item = group.items.find((it) => ("tool" in it ? it.tool : it.action) === key);
        if (!item) return;
        if ("tool" in item) onPick(group, item);
        else if (item.action === "live") openActionsWith("Live frame");
        else pickImages(viewCenter);
    };
    return (
        <div className="flex items-center">
            <ToolButton def={current} active={!disabled && Boolean(inGroup)} disabled={disabled} onPress={() => onPick(group, current)} />
            {group.items.length > 1 && (
                <AriaMenuTrigger>
                    <AriaButton aria-label={`More ${group.id} tools`} isDisabled={disabled} className={`flex items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink data-[pressed]:bg-panel-hover data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent ${compact ? "h-6 w-3.5" : "h-8 w-4"}`}>
                        <ChevronDown className={compact ? "size-2.5" : "size-3"} />
                    </AriaButton>
                    <AriaPopover placement="top start" offset={compact ? 10 : 14} className="min-w-52 rounded-xl bg-tooltip p-1.5 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" onAction={(key) => run(String(key))}>
                            {group.items.map((item) => {
                                const key = "tool" in item ? item.tool : item.action;
                                return <MenuRow key={key} id={key} label={item.label} shortcut={item.shortcut} icon={item.icon} checked={"tool" in item && item.tool === current.tool} />;
                            })}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            )}
        </div>
    );
}

// Draw mode's big tools, drawn as the real things standing in the bar: the active one rises out of
// it, the others peek up on hover. The tip takes the colour being drawn with.
function DrawToolButton({ def, active, onPress }: { def: (typeof DRAW_TOOLS)[number]; active: boolean; onPress: () => void }) {
    const Icon = def.icon;
    const tint = useEditor((s) => s.prefs.drawColor);
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton
                aria-label={def.label}
                aria-pressed={active}
                onPress={onPress}
                style={{ clipPath: "inset(-60px -6px 0 -6px)" }}
                className="group relative h-8 w-9 shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
                <Icon
                    tint={tint}
                    className={`absolute left-1/2 w-8 -translate-x-1/2 drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] transition-[top] duration-150 ${active ? "-top-6" : "top-0.5 group-hover:-top-1.5"}`}
                />
            </AriaButton>
            <AriaTooltip offset={10} className={tip}>
                {def.label}
                {def.shortcut && <span className="ml-2 text-white/50">{def.shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

const STYLES: { id: DrawStyle; label: string; width: number; opacity: number; cap: "round" | "butt" }[] = [
    { id: "pencil", label: "Pencil", width: 2.5, opacity: 1, cap: "round" },
    { id: "marker", label: "Marker", width: 7, opacity: 0.75, cap: "butt" },
    { id: "ink", label: "Ink", width: 4, opacity: 1, cap: "round" },
];

function StrokePreview({ style, color }: { style: (typeof STYLES)[number]; color?: string }) {
    return (
        <svg viewBox="0 0 120 20" className="h-5 w-28" fill="none">
            <path d="M4 12c20-14 30 10 50 2s30-14 62-2" stroke={color ?? "currentColor"} strokeWidth={style.width} strokeOpacity={style.opacity} strokeLinecap={style.cap} />
        </svg>
    );
}

// The strip above the Draw tools: colour, size, a slider and the stroke style, plus a one-time
// hint that ⌘click samples a stroke.
function DrawStrip({ tool }: { tool: Tool }) {
    const prefs = useEditor((s) => s.prefs);
    const [closed, setClosed] = useState<Tool | null>(null);
    if (closed === tool) return null;
    const style = STYLES.find((s) => s.id === prefs.drawStyle) ?? STYLES[0];
    const setSize = (n: number) => editor.setPrefs({ drawSize: Math.max(1, Math.min(64, Math.round(n) || 1)) });
    return (
        <div className="pointer-events-auto flex flex-col items-center gap-2">
            {!prefs.drawHintSeen && (
                <div className="flex h-9 items-center gap-2 rounded-xl border border-brand-500/30 bg-[#1C2B45] px-3 text-[12px] text-brand-500 shadow-lg">
                    <span aria-hidden="true">✦</span>
                    <span>⌘+click a stroke to sample properties</span>
                    <AriaButton aria-label="Dismiss" onPress={() => editor.setPrefs({ drawHintSeen: true })} className="ml-2 flex size-6 items-center justify-center rounded text-brand-500 outline-none hover:bg-white/10">
                        <X className="size-3.5" />
                    </AriaButton>
                </div>
            )}
            <div className="flex h-12 items-center gap-2 rounded-2xl border border-panel-border bg-panel px-2 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
                <ColorSwatch size={8} color={prefs.drawColor} label="Stroke colour" placement="top" onChange={(drawColor) => editor.setPrefs({ drawColor })} />
                <div className="flex h-8 items-center rounded-lg bg-field">
                    <input
                        type="number"
                        min={1}
                        max={64}
                        value={prefs.drawSize}
                        aria-label="Stroke size"
                        onChange={(e) => setSize(Number(e.target.value))}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-8 w-14 bg-transparent px-2 text-[12px] text-ink outline-none"
                    />
                    <input type="range" min={1} max={64} value={prefs.drawSize} aria-label="Stroke size" onChange={(e) => setSize(Number(e.target.value))} className="mx-2 w-32 accent-brand-500" />
                </div>
                {tool === "brush" && <BrushMenu color={prefs.drawColor} />}
                {tool === "pencil" && (
                    <AriaMenuTrigger>
                        <AriaButton aria-label="Stroke style" className="flex h-8 items-center gap-2 rounded-lg bg-field px-2 text-ink outline-none hover:bg-panel-hover">
                            <StrokePreview style={style ?? STYLES[0]!} color={prefs.drawColor} />
                            <ChevronDown className="size-3 text-ink-muted" />
                        </AriaButton>
                        <AriaPopover placement="top" offset={8} className="rounded-xl bg-tooltip p-1.5 text-white shadow-xl outline-none">
                            <AriaMenu className="outline-none" onAction={(k) => editor.setPrefs({ drawStyle: String(k) as DrawStyle })}>
                                {STYLES.map((s) => (
                                    <AriaMenuItem key={s.id} id={s.id} className="flex h-8 cursor-default items-center gap-3 rounded px-2 text-[11px] outline-none data-[focused]:bg-brand-500">
                                        <span className="w-3 text-center">{prefs.drawStyle === s.id ? "✓" : ""}</span>
                                        <StrokePreview style={s} />
                                        <span className="w-12">{s.label}</span>
                                    </AriaMenuItem>
                                ))}
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                )}
                <div className="h-6 w-px bg-panel-border" />
                <AriaButton aria-label="Close" onPress={() => setClosed(tool)} className="flex size-8 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <X className="size-4" />
                </AriaButton>
            </div>
        </div>
    );
}

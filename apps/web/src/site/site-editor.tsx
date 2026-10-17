import { ChevronDown, ChevronLeft, Database01, Download01, FlipBackward, FlipForward, Hand, Image01, LayoutLeft, MessageCircle01, Play, PlusCircle, Settings01, Type01 } from "@untitledui/icons";
import { useEffect, useRef, useState, type FC, type ReactNode, type SVGProps } from "react";
import {
    Button as AriaButton,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Separator as AriaSeparator,
    Tooltip as AriaTooltip,
    TooltipTrigger as AriaTooltipTrigger,
} from "react-aria-components";
import { CanvasView } from "../canvas/canvas-view";
import { sceneFocus } from "../canvas/hit-test";
import { ActionsPalette } from "../components/actions-palette";
import { NamePrompt, ShareButton } from "../components/collab-ui";
import { CommentsPanel } from "../components/comments-ui";
import { ContextMenu } from "../components/context-menu";
import { ErrorBoundary } from "../components/error-boundary";
import { FloatingBars } from "../components/floating-bars";
import { PresenceAvatars } from "../components/follow-ui";
import { MenuRow } from "../components/left-sidebar";
import { ShortcutsPanel } from "../components/shortcuts-panel";
import { SaveVersionDialog, VersionHistoryPanel } from "../components/version-history";
import { fitRect, zoomBy, zoomTo, zoomToFit } from "../engine/camera";
import { useCollab } from "../engine/collab";
import { createFile, openFile, renameFile } from "../engine/files";
import { pickImages } from "../engine/images";
import { viewCenter } from "../engine/actions";
import { ACTION_BY_ID, actionLabel, runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import { toggleShortcuts } from "../engine/ui-state";
import type { SceneNode, Tool } from "../engine/types";
import { SiteDialogs } from "./dialogs";
import { SiteInspector } from "./inspector";
import { bpFrames, breakpointsOf, pageData, sitePages } from "./model";
import { AddBreakpointMenu } from "./breakpoints";
import { InlinePreview } from "./inline-preview";
import { addPage } from "./blocks";
import { CmsPanel, CmsView, FilePanel, InsertPanel } from "./panels";
import { openPreview } from "./preview";
import { downloadSite } from "./publish";
import { site, useSite, type SitePanel } from "./state";
import "./plugin";

// The site editor: a 48pt rail on the left (File, Insert, CMS and the site settings), the panel it
// opens (the file's name, where it is and Publish… on top), the canvas with each page's breakpoint
// frames side by side and a 452×48 toolbar floating over it, and the 240 right panel (people,
// preview and Share; Design and Interaction tabs and the zoom menu). There is no bar over the
// canvas: breakpoints are frames, added from the "+" on each page's header. The CMS replaces the
// canvas with its own view.

const MENU_CLASS = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";
const MENU_ITEMS = ["home", "siteNew", "-", "undo", "redo", "-", "siteSettings", "siteDownload", "-", "saveVersion", "history", "duplicateFile", "-", "shortcuts", "actions"];
const OWN_ITEMS: Record<string, { label: string; run: () => void }> = {
    siteNew: { label: "New site", run: () => void openFile(createFile("site").id) },
    siteSettings: { label: "Site settings…", run: () => site.set({ dialog: { kind: "settings" } }) },
    siteDownload: { label: "Download site (.zip)", run: () => void downloadSite() },
};

function Mark(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M3.5 12.5v-9l4.5 4.5 4.5-4.5v9" />
        </svg>
    );
}

function MainMenu() {
    const s = useEditor((state) => state);
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Main menu" className="flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                <Mark className="size-4" />
            </AriaButton>
            <AriaPopover placement="right top" offset={6} className={MENU_CLASS}>
                <AriaMenu aria-label="Main menu" className="outline-none" onAction={(key) => (OWN_ITEMS[String(key)]?.run ?? (() => runAction(String(key))))()}>
                    {MENU_ITEMS.map((id, i) => {
                        if (id === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                        const own = OWN_ITEMS[id];
                        if (own) return <MenuRow key={id} id={id} label={own.label} />;
                        const action = ACTION_BY_ID.get(id);
                        return action ? <MenuRow key={id} id={id} label={actionLabel(action, s)} shortcut={action.shortcut} /> : null;
                    })}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The rail's tooltips (to the right of the buttons).
function RailTip({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactElement }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            {children}
            <AriaTooltip placement="right" offset={8} className="rounded-[5px] bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-3 text-[#B1B1B1]">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

// The toolbar's tooltips: a dark 24pt body with a 1pt ring, the shortcut as a grey second run, and
// a 5pt caret pointing down at the tool.
function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
    return (
        <span className="group/tip relative flex">
            {children}
            <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+11px)] left-1/2 z-40 flex h-6 -translate-x-1/2 items-center whitespace-nowrap rounded-[5px] bg-[#1E1E1E] pl-[9px] pr-[9.5px] text-[11px] text-white opacity-0 ring-1 ring-white/15 transition-opacity group-hover/tip:opacity-100 group-hover/tip:delay-300">
                {label}
                {shortcut && <span className="ml-3 text-[#B1B1B1]">{shortcut}</span>}
                <span aria-hidden="true" className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#1E1E1E]" />
            </span>
        </span>
    );
}

function RailButton({ icon: Icon, label, shortcut, active, disabled, onPress }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; shortcut?: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
    return (
        <RailTip label={label} shortcut={shortcut}>
            <AriaButton aria-label={label} aria-pressed={active} isDisabled={disabled} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-35 ${active ? "bg-brand-500/15 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                <Icon className="size-4" />
            </AriaButton>
        </RailTip>
    );
}

const PANELS: { id: SitePanel; label: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { id: "file", label: "Pages and layers", icon: LayoutLeft },
    { id: "insert", label: "Insert", icon: PlusCircle },
    { id: "cms", label: "CMS", icon: Database01 },
];

function Rail() {
    const panel = useSite((s) => s.panel);
    const readOnly = useEditor((s) => s.readOnly);
    const canUndo = useEditor((s) => s.past.length > 0);
    const canRedo = useEditor((s) => s.future.length > 0);
    return (
        <nav aria-label="Site tools" className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-panel-border bg-panel pt-2 pb-2">
            <MainMenu />
            <span className="h-px w-6 bg-panel-border" />
            {PANELS.map((p) => (
                <RailButton key={p.id} icon={p.icon} label={p.label} active={panel === p.id} disabled={readOnly && p.id === "insert"} onPress={() => site.set({ panel: p.id, panelHidden: false })} />
            ))}
            <RailButton icon={Settings01} label="Site settings" onPress={() => site.set({ dialog: { kind: "settings" } })} />
            <div className="flex-1" />
            <RailButton icon={Download01} label="Download site (.zip)" onPress={() => void downloadSite()} />
            <RailButton icon={FlipBackward} label="Undo" shortcut="⌘Z" disabled={!canUndo || readOnly} onPress={() => editor.undo()} />
            <RailButton icon={FlipForward} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo || readOnly} onPress={() => editor.redo()} />
        </nav>
    );
}

// ---- The toolbar ----

function MoveIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M3 2.5 13 6.6 8.4 8.4 6.6 13 3 2.5Z" />
        </svg>
    );
}

function WebpageIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" {...props}>
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
            <path d="M2 5.5h12M6 5.5v8" />
        </svg>
    );
}

function ComponentIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M8 1.8 10 3.8 8 5.8 6 3.8ZM8 10.2 10 12.2 8 14.2 6 12.2ZM3.8 6 5.8 8 3.8 10 1.8 8ZM12.2 6 14.2 8 12.2 10 10.2 8Z" />
        </svg>
    );
}

function RectIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx=".5" />
        </svg>
    );
}

function PenIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M8 14.5 2.8 9.3 4.4 4.4 11.6 2.8l1.6 7.2-5.2 4.5ZM4.4 4.4l3.1 3.1" />
            <circle cx="8.2" cy="7.8" r="1" />
        </svg>
    );
}

function ActionsIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" {...props}>
            <rect x="2" y="2" width="5" height="5" rx="1.2" />
            <circle cx="11.5" cy="4.5" r="2.5" />
            <circle cx="4.5" cy="11.5" r="2.5" />
            <path d="M11.5 9v5M9 11.5h5" strokeLinecap="round" />
        </svg>
    );
}

type MenuTool = { id: string; label: string; shortcut?: string; run: () => void; tool?: Tool };

// A tool with a caret beside it: the button uses the group's current tool; the caret lists the rest.
function ToolGroup({ label, shortcut, icon: Icon, active, onPress, items }: { label: string; shortcut?: string; icon: FC<SVGProps<SVGSVGElement>>; active: boolean; onPress: () => void; items: MenuTool[] }) {
    return (
        <span className="flex items-center">
            <Tip label={label} shortcut={shortcut}>
                <AriaButton aria-label={label} aria-pressed={active} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${active ? "bg-brand-500 text-white" : "text-ink hover:bg-panel-hover"}`}>
                    <Icon className="size-4" />
                </AriaButton>
            </Tip>
            <AriaMenuTrigger>
                <AriaButton aria-label={`${label} options`} className="flex h-8 w-4 items-center justify-center rounded-[4px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="top start" offset={8} className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu aria-label={`${label} options`} className="outline-none" onAction={(key) => items.find((i) => i.id === key)?.run()}>
                        {items.map((i) => (
                            <MenuRow key={i.id} id={i.id} label={i.label} shortcut={i.shortcut} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </span>
    );
}

function ToolButton({ label, shortcut, icon: Icon, active, onPress }: { label: string; shortcut?: string; icon: FC<SVGProps<SVGSVGElement>>; active?: boolean; onPress: () => void }) {
    return (
        <Tip label={label} shortcut={shortcut}>
            <AriaButton aria-label={label} aria-pressed={active} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${active ? "bg-brand-500 text-white" : "text-ink hover:bg-panel-hover"}`}>
                <Icon className="size-4" />
            </AriaButton>
        </Tip>
    );
}

const pick = (tool: Tool) => () => editor.set({ tool, editingTextId: null });

const SHAPES: MenuTool[] = [
    { id: "rect", label: "Rectangle", shortcut: "R", run: pick("rect"), tool: "rect" },
    { id: "ellipse", label: "Ellipse", shortcut: "O", run: pick("ellipse"), tool: "ellipse" },
    { id: "line", label: "Line", shortcut: "L", run: pick("line"), tool: "line" },
    { id: "arrow", label: "Arrow", shortcut: "⇧L", run: pick("arrow"), tool: "arrow" },
    { id: "polygon", label: "Polygon", run: pick("polygon"), tool: "polygon" },
    { id: "star", label: "Star", run: pick("star"), tool: "star" },
];
const PENS: MenuTool[] = [
    { id: "pen", label: "Pen", shortcut: "P", run: pick("pen"), tool: "pen" },
    { id: "pencil", label: "Pencil", shortcut: "⇧P", run: pick("pencil"), tool: "pencil" },
];

// 452×48: Move ⌄ (move, hand), Webpage ⌄ (webpage, frame), Insert ⌄ (blocks, templates),
// Rectangle ⌄ (rectangle, ellipse, line, arrow, polygon, star), Pen ⌄ (pen, pencil), image, text,
// comment and actions.
function Toolbar() {
    const tool = useEditor((s) => s.tool);
    const readOnly = useEditor((s) => s.readOnly);
    if (readOnly) {
        return (
            <div role="toolbar" aria-label="Tools" className="pointer-events-auto flex h-12 items-center gap-2 rounded-[13px] bg-panel px-2 shadow-lg ring-1 ring-black/5">
                <ToolButton label="Move" shortcut="V" icon={MoveIcon} active={tool === "move"} onPress={pick("move")} />
                <ToolButton label="Hand" shortcut="H" icon={Hand} active={tool === "hand"} onPress={pick("hand")} />
                <ToolButton label="Comment" shortcut="C" icon={MessageCircle01} active={tool === "comment"} onPress={() => editor.set({ tool: tool === "comment" ? "move" : "comment" })} />
            </div>
        );
    }
    const shape = SHAPES.find((s) => s.tool === tool) ?? (SHAPES[0] as MenuTool);
    const pen = PENS.find((p) => p.tool === tool) ?? (PENS[0] as MenuTool);
    const hand = tool === "hand";
    return (
        <div role="toolbar" aria-label="Tools" className="pointer-events-auto flex h-12 w-[452px] items-center rounded-[13px] bg-panel pl-[7px] pr-2 shadow-lg ring-1 ring-black/5">
            <ToolGroup label={hand ? "Hand" : "Move"} shortcut={hand ? "H" : "V"} icon={hand ? Hand : MoveIcon} active={tool === "move" || hand} onPress={pick(hand ? "hand" : "move")} items={[{ id: "move", label: "Move", shortcut: "V", run: pick("move") }, { id: "hand", label: "Hand", shortcut: "H", run: pick("hand") }]} />
            <span className="w-[9px]" />
            <ToolGroup label="Webpage" shortcut="W" icon={WebpageIcon} active={tool === "frame"} onPress={() => addPage("blank")} items={[{ id: "page", label: "Webpage", shortcut: "W", run: () => addPage("blank") }, { id: "frame", label: "Frame", shortcut: "F", run: pick("frame") }]} />
            <span className="w-[9px]" />
            <ToolGroup
                label="Insert"
                icon={ComponentIcon}
                active={false}
                onPress={() => site.set({ panel: "insert", panelHidden: false })}
                items={[
                    { id: "blocks", label: "Blocks", run: () => site.set({ panel: "insert", insertTab: "blocks", panelHidden: false }) },
                    { id: "templates", label: "Templates", run: () => site.set({ panel: "insert", insertTab: "templates", panelHidden: false }) },
                ]}
            />
            <span className="w-[9px]" />
            <ToolGroup label={shape.label} shortcut={shape.shortcut} icon={RectIcon} active={SHAPES.some((s) => s.tool === tool)} onPress={shape.run} items={SHAPES} />
            <span className="w-[9px]" />
            <ToolGroup label={pen.label} shortcut={pen.shortcut} icon={PenIcon} active={tool === "pen" || tool === "pencil"} onPress={pen.run} items={PENS} />
            <span className="w-[9px]" />
            <span className="flex items-center gap-2">
                <ToolButton label="Image" shortcut="⇧⌘K" icon={Image01} onPress={() => pickImages(viewCenter)} />
                <ToolButton label="Text" shortcut="T" icon={Type01} active={tool === "text"} onPress={pick("text")} />
                <ToolButton label="Comment" shortcut="C" icon={MessageCircle01} active={tool === "comment"} onPress={() => editor.set({ tool: tool === "comment" ? "move" : "comment", editingTextId: null })} />
                <ToolButton label="Actions" shortcut="⌘K" icon={ActionsIcon} onPress={() => editor.set({ actionsOpen: true })} />
            </span>
        </div>
    );
}

function Help() {
    return (
        <AriaButton aria-label="Keyboard shortcuts and help" onPress={toggleShortcuts} className="fixed right-3 bottom-3 z-20 flex size-8 items-center justify-center rounded-full bg-panel text-[15px] text-ink shadow-sm ring-1 ring-black/5 outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
            ?
        </AriaButton>
    );
}

function Toast() {
    const toast = useEditor((s) => s.toast);
    const busy = useSite((s) => s.busy);
    const text = busy ?? toast;
    if (!text) return null;
    return (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center">
            <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{text}</div>
        </div>
    );
}

// Frames the breakpoint in view (or all of them) when the page or the view changes; one breakpoint
// at a time hides the others.
function useBreakpointView(main: React.RefObject<HTMLElement | null>) {
    const view = useSite((s) => s.view);
    const pageId = useEditor((s) => s.pageId);
    const frameId = useEditor((s) => (view === "all" ? null : (bpFrames(s.doc, s.pageId)[view]?.id ?? null)));
    useEffect(() => {
        sceneFocus.id = frameId;
        editor.set({});
        const doc = editor.get().doc;
        const frames = Object.values(bpFrames(doc, pageId)).filter((f): f is SceneNode => Boolean(f));
        const shown = frameId ? frames.filter((f) => f.id === frameId) : frames;
        if (!shown.length) return;
        const x = Math.min(...shown.map((f) => f.x));
        const y = Math.min(...shown.map((f) => f.y));
        const right = Math.max(...shown.map((f) => f.x + f.w));
        const h = Math.min(Math.max(...shown.map((f) => f.h)), 1400);
        requestAnimationFrame(() => fitRect({ x, y: y - 30, w: right - x, h: h + 30 }, 60, 1));
    }, [frameId, pageId, main]);
    useEffect(
        () => () => {
            sceneFocus.id = null;
        },
        [],
    );
}

function Canvas() {
    const ref = useRef<HTMLElement | null>(null);
    const uiHidden = useEditor((s) => s.uiHidden);
    useBreakpointView(ref);
    return (
        <main ref={ref} className="relative min-w-0 flex-1 bg-canvas" data-site-canvas>
            <ErrorBoundary name="canvas">
                <CanvasView />
            </ErrorBoundary>
            {!uiHidden && (
                <>
                    <EmptyPage />
                    {/* Centred on the window, as the reference's floating toolbar is (not on the canvas). */}
                    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2">
                        <FloatingBars />
                        <Toolbar />
                    </div>
                    <Help />
                    <AddBreakpointMenu />
                </>
            )}
            <InlinePreview />
            <Toast />
        </main>
    );
}

// A page with nothing on it yet points to the Insert panel.
function EmptyPage() {
    const empty = useEditor((s) => {
        const desktop = bpFrames(s.doc, s.pageId).desktop;
        return Boolean(desktop) && desktop?.children.length === 0 && !pageData(s.doc.nodes[s.pageId])?.collectionId;
    });
    const readOnly = useEditor((s) => s.readOnly);
    const publishing = useSite((s) => s.dialog?.kind === "publish");
    if (!empty || readOnly || publishing) return null;
    return (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-panel-border bg-panel px-4 py-3 text-[12px] shadow-lg">
                <span className="text-ink-muted">This page is empty. Start with a navigation bar, a hero and a few sections.</span>
                <AriaButton onPress={() => site.set({ panel: "insert", insertTab: "blocks", panelHidden: false })} className="h-7 rounded-[6px] bg-brand-500 px-3 text-[11px] font-semibold text-white outline-none hover:brightness-110">
                    Insert blocks
                </AriaButton>
                <AriaButton onPress={() => site.set({ panel: "insert", insertTab: "templates", panelHidden: false })} className="h-7 rounded-[6px] border border-panel-border px-3 text-[11px] font-semibold text-ink outline-none hover:bg-panel-hover">
                    Use a template
                </AriaButton>
            </div>
        </div>
    );
}

// The right panel's top row: people, then preview (▶, its options in the caret) and Share.
function PanelTop() {
    const busy = useSite((s) => s.busy);
    return (
        <div className="flex h-12 shrink-0 items-center gap-1 px-2">
            <PresenceAvatars chevron />
            <div className="flex-1" />
            <AriaTooltipTrigger delay={400} closeDelay={0}>
                <AriaButton aria-label="Preview" isDisabled={Boolean(busy)} onPress={() => site.set({ inlinePreview: true })} className="flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-50">
                    <Play className="size-4" />
                </AriaButton>
                <AriaTooltip placement="bottom" offset={6} className="rounded-[5px] bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                    Preview<span className="ml-3 text-[#B1B1B1]">⇧Space</span>
                </AriaTooltip>
            </AriaTooltipTrigger>
            <AriaMenuTrigger>
                <AriaButton aria-label="Preview options" className="-ml-1 flex h-8 w-4 items-center justify-center rounded-[4px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom end" offset={6} className={MENU_CLASS}>
                    <AriaMenu aria-label="Preview options" className="outline-none" onAction={(key) => (key === "inline" ? site.set({ inlinePreview: true }) : openPreview())}>
                        <MenuRow id="inline" label="Inline preview" shortcut="⇧Space" />
                        <MenuRow id="tab" label="Open in a new tab" shortcut="⌥⌘↵" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <ShareButton className="ml-1.5 h-8! w-[54px] rounded-[5px]! px-0! text-[11px]!" />
        </div>
    );
}

// The zoom menu at the end of the right panel's tab row: the zoom level, zoom commands, and which
// breakpoints are shown (all side by side, or one at a time).
function ZoomMenu() {
    const zoom = useEditor((s) => s.camera.zoom);
    const view = useSite((s) => s.view);
    const list = useEditor((s) => breakpointsOf(s.doc, s.pageId));
    const run = (key: string) => {
        if (key === "in") zoomBy(1.25);
        else if (key === "out") zoomBy(1 / 1.25);
        else if (key === "fit") zoomToFit();
        else if (key === "100") zoomTo(1);
        else if (key === "50") zoomTo(0.5);
        else if (key.startsWith("view:")) site.set({ view: key.slice(5) });
    };
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Zoom and view" className="flex h-6 items-center gap-0.5 rounded-[5px] px-1.5 text-[11px] text-ink outline-none hover:bg-panel-hover">
                {Math.round(zoom * 100)}%
                <ChevronDown className="size-3 text-ink-muted" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={6} className={MENU_CLASS}>
                <AriaMenu aria-label="Zoom and view" className="outline-none" onAction={(key) => run(String(key))}>
                    <MenuRow id="in" label="Zoom in" shortcut="⌘+" />
                    <MenuRow id="out" label="Zoom out" shortcut="⌘−" />
                    <MenuRow id="fit" label="Zoom to fit" shortcut="⇧1" />
                    <MenuRow id="50" label="Zoom to 50%" />
                    <MenuRow id="100" label="Zoom to 100%" shortcut="⌘0" />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="view:all" label="All breakpoints" checked={view === "all"} />
                    {list.map((b) => (
                        <MenuRow key={b.id} id={`view:${b.id}`} label={`${b.label} only`} checked={view === b.id} />
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function RightSide() {
    const history = useCollab((s) => s.historyOpen);
    const commenting = useEditor((s) => s.tool === "comment");
    if (history) return <VersionHistoryPanel />;
    if (commenting) return <CommentsPanel />;
    return <SiteInspector top={<PanelTop />} zoom={<ZoomMenu />} />;
}

// The top of the left panel: the file's name (its menu, or double-click to rename), where it is,
// Beta, hiding the panel, and Publish….
function PanelHead() {
    const name = useEditor((s) => s.doc.name);
    const fileId = useEditor((s) => s.fileId);
    const shared = useCollab((s) => s.status !== "local");
    const readOnly = useEditor((s) => s.readOnly);
    const [renaming, setRenaming] = useState(false);
    const rename = (next: string) => {
        setRenaming(false);
        const value = next.trim();
        if (!value || value === name) return;
        editor.execute({ type: "doc.rename", name: value });
        if (fileId) renameFile(fileId, value);
    };
    return (
        <div className="shrink-0 border-b border-panel-border px-4 pt-2.5 pb-4">
            <div className="flex h-8 items-center gap-1">
                {renaming ? (
                    <input autoFocus aria-label="Site name" defaultValue={name} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.target as HTMLInputElement).blur() : e.key === "Escape" && setRenaming(false))} className="h-7 min-w-0 flex-1 rounded-[5px] bg-field px-1 text-[13px] font-semibold outline-none ring-1 ring-brand-500" />
                ) : (
                    <AriaMenuTrigger>
                        <AriaButton aria-label="File" onDoubleClick={() => !readOnly && setRenaming(true)} className="flex min-w-0 items-center gap-1 rounded-[5px] py-1 pr-1 text-[13px] font-semibold text-ink outline-none hover:bg-panel-hover">
                            <span className="truncate">{name || "Untitled"}</span>
                            <ChevronDown className="size-3 shrink-0 text-ink-muted" />
                        </AriaButton>
                        <AriaPopover placement="bottom start" offset={4} className={MENU_CLASS}>
                            <AriaMenu aria-label="File" className="outline-none" disabledKeys={readOnly ? ["rename"] : []} onAction={(key) => (key === "rename" ? setRenaming(true) : (OWN_ITEMS[String(key)]?.run ?? (() => runAction(String(key))))())}>
                                <MenuRow id="rename" label="Rename" />
                                <MenuRow id="duplicateFile" label="Duplicate" />
                                <MenuRow id="saveVersion" label="Save to version history" />
                                <MenuRow id="history" label="Show version history" />
                                <MenuRow id="siteDownload" label="Download site (.zip)" />
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                )}
                <div className="flex-1" />
                <span className="rounded-[4px] bg-panel-hover px-1.5 text-[11px] leading-[18px] text-ink-muted">Beta</span>
                <AriaButton aria-label="Hide the panel" onPress={() => site.set({ panelHidden: true })} className="flex size-6 items-center justify-center rounded-[5px] text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <LayoutLeft className="size-4" />
                </AriaButton>
            </div>
            <div className="mb-3 text-[11px] text-ink-muted">{shared ? "Shared" : "Drafts"}</div>
            <AriaButton isDisabled={readOnly} onPress={() => site.set({ dialog: { kind: "publish" } })} className="h-6 w-full rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover disabled:opacity-50">
                Publish…
            </AriaButton>
        </div>
    );
}

function SidePanel() {
    const panel = useSite((s) => s.panel);
    return (
        <aside aria-label="Site panel" className="flex h-full w-[248px] shrink-0 flex-col border-r border-panel-border bg-panel text-[11.5px] text-ink">
            <PanelHead />
            {panel === "insert" ? <InsertPanel /> : panel === "cms" ? <CmsPanel /> : <FilePanel />}
        </aside>
    );
}

// Site shortcuts: W adds a webpage, ⇧Space opens the inline preview, ⌥⌘↵ the full preview.
function useSiteKeys() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            const s = editor.get();
            if (s.editingTextId || site.get().dialog) return;
            if (e.code === "Space" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                site.set({ inlinePreview: !site.get().inlinePreview });
            } else if (e.key === "Enter" && e.altKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                openPreview();
            } else if (e.code === "KeyW" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !s.readOnly && !site.get().inlinePreview) {
                e.preventDefault();
                e.stopPropagation();
                addPage("blank");
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
}

// The CMS view in place of the canvas and the right panel: "‹ CMS" with people and Share on top.
function CmsCanvas() {
    return (
        <main className="flex min-w-0 flex-1 flex-col bg-canvas" data-site-canvas>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-panel-border bg-panel px-3">
                <AriaButton aria-label="Back to the canvas" onPress={() => site.set({ panel: "file" })} className="flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                    <ChevronLeft className="size-4" />
                </AriaButton>
                <span className="text-[13px] font-semibold">CMS</span>
                <div className="flex-1" />
                <PresenceAvatars chevron />
                <ShareButton className="ml-2 h-8! w-[54px] rounded-[5px]! px-0! text-[11px]!" />
            </div>
            <CmsView />
        </main>
    );
}

export function SiteEditor() {
    const uiHidden = useEditor((s) => s.uiHidden);
    const fileId = useEditor((s) => s.fileId);
    const panel = useSite((s) => s.panel);
    const cmsMode = useSite((s) => s.cmsMode);
    const panelHidden = useSite((s) => s.panelHidden);
    useSiteKeys();
    // A newly opened site starts on its home page with every breakpoint in view.
    useEffect(() => {
        site.set({ panel: "file", view: "all", dialog: null, rightTab: "design", cmsMode: "edit" });
        const s = editor.get();
        const first = sitePages(s.doc)[0];
        if (first && !pageData(s.doc.nodes[s.pageId])) editor.setPage(first.id);
    }, [fileId]);
    useEffect(() => {
        document.documentElement.dataset.product = "site";
        return () => {
            delete document.documentElement.dataset.product;
        };
    }, []);
    useEffect(() => () => site.set({ dialog: null }), []);
    const cms = panel === "cms" && cmsMode === "edit";
    return (
        <div className="flex min-h-0 w-full flex-1 bg-canvas text-[11px]" data-site>
            {!uiHidden && <Rail />}
            {!uiHidden && !panelHidden && <SidePanel />}
            {cms ? <CmsCanvas /> : <Canvas />}
            {!uiHidden && !cms && <RightSide />}
            <SiteDialogs />
            <ContextMenu />
            <ActionsPalette />
            <ShortcutsPanel />
            <NamePrompt />
            <SaveVersionDialog />
        </div>
    );
}

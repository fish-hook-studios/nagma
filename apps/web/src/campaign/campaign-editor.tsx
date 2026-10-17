import { ChevronDown, Hand, LayoutAlt04, MessageCircle01, Minus, Plus, X } from "@untitledui/icons";
import { useEffect, useRef, useState, type FC, type ReactNode, type SVGProps } from "react";
import {
    Button as AriaButton,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Tooltip as AriaTooltip,
    TooltipTrigger as AriaTooltipTrigger,
} from "react-aria-components";
import { sceneFocus } from "../canvas/hit-test";
import { CanvasView } from "../canvas/canvas-view";
import { ActionsPalette } from "../components/actions-palette";
import { NamePrompt, ShareButton } from "../components/collab-ui";
import { CommentsPanel } from "../components/comments-ui";
import { ErrorBoundary } from "../components/error-boundary";
import { FloatingBars } from "../components/floating-bars";
import { PresenceAvatars } from "../components/follow-ui";
import { MenuRow } from "../components/left-sidebar";
import { RightPanel } from "../components/right-panel";
import { ShortcutsPanel } from "../components/shortcuts-panel";
import { Toolbar } from "../components/toolbar";
import { DesignModeIcon } from "../components/toolbar-icons";
import { SaveVersionDialog, VersionHistoryPanel } from "../components/version-history";
import { ZoomMenu } from "../components/zoom-menu";
import { zoomBy } from "../engine/camera";
import { collab, useCollab } from "../engine/collab";
import { runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import { toggleShortcuts } from "../engine/ui-state";
import { fitAssets, frameCurrent } from "./actions";
import { InsertsPanel, MediaPanel, PluginsPanel, TextPanel } from "./add-panels";
import { BulkHeader, BulkTable } from "./bulk-edit";
import { ContextToolbar } from "./context-toolbar";
import { CampaignDialogs } from "./dialogs";
import { AssetStrip, AssetsPanel } from "./left-panel";
import { StarterPicture, TemplatesPanel } from "./template-library";
import { CampaignContextMenu } from "./asset-menu";
import { SIZE_GROUPS, SIZE_PRESETS, STARTER_LAYOUTS, addBlankAsset, addRow, addStarterTemplate, assetData, assetOf, assetsOf, deleteAssets, duplicateAssets, firstAsset as firstAssetOf, presetFor, rowsOf } from "./model";
import { Rail } from "./rail";
import { ReviewsPanel, useReviewSync } from "./reviews";
import { campaign, inEditMode, isCampaignDoc, useCampaign, type CampaignMode } from "./state";
import "./plugin";

// The campaign editor, laid out like a brand asset tool: a narrow rail of panels on the left, the
// asset list (or the panel the rail opened, with the assets folded into a strip beside it) and the
// canvas filling the rest. The asset view shows one asset at a time; the grid view shows them all.
// In the product's own mode there's no properties panel: a floating toolbar over the selection
// carries its controls, the file's people, Export and Share float at the top right, and Move, Hand
// and Comment sit in a bar at the bottom with the mode pair. Design mode swaps in the design
// editor around the same rail and panels: its toolbar, its Design panel and its blue accent.
// Bulk edit swaps the panel and canvas for a spreadsheet of every asset beside a large preview.

// Account, Export and Share, floating over the canvas (or in Bulk edit's header).
function TopRight({ inline }: { inline?: boolean }) {
    const history = useCollab((s) => s.historyOpen);
    return (
        <div className={`flex items-center ${inline ? "ml-auto shrink-0 gap-2" : "h-12 gap-2 rounded-[13px] bg-panel p-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.25)]"}`}>
            <div className="flex items-center">
                <PresenceAvatars />
                <AriaMenuTrigger>
                    <AriaButton aria-label="File people and history" className="flex size-[22px] items-center justify-center rounded-full bg-field text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500">
                        <ChevronDown className="size-3" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" offset={6} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            aria-label="File"
                            className="outline-none"
                            onAction={(key) => {
                                if (key === "comments") editor.set({ tool: editor.get().tool === "comment" ? "move" : "comment" });
                                else if (key === "history") collab.set({ historyOpen: !history });
                                else runAction(String(key));
                            }}
                        >
                            <MenuRow id="comments" label="Comments" shortcut="C" />
                            <MenuRow id="history" label={history ? "Hide version history" : "Version history"} />
                            <MenuRow id="saveVersion" label="Save to version history…" shortcut="⌥ ⌘ S" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>
            <AriaButton onPress={() => campaign.set({ dialog: { kind: "export" } })} className={`ml-1 h-8 px-3 shrink-0 rounded-[5px] border border-panel-border text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500`}>
                Export
            </AriaButton>
            <ShareButton className="h-8! shrink-0 rounded-[5px]! px-3! text-[11px]!" />
        </div>
    );
}

function BarButton({ icon: Icon, label, shortcut, active, onPress }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; shortcut?: string; active?: boolean; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            <AriaButton aria-label={label} aria-pressed={active} onPress={onPress} className={`flex size-8 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 ${active ? "bg-brand-500 text-white" : "text-ink hover:bg-panel-hover"}`}>
                <Icon className="size-5" />
            </AriaButton>
            <AriaTooltip offset={8} className="flex h-6 items-center rounded-[5px] bg-tooltip px-2 text-[11px] text-white shadow-lg ring-1 ring-[#363636]">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

function MoveIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M3 2.5 13 6.6 8.4 8.4 6.6 13 3 2.5Z" />
        </svg>
    );
}

// The product's own mode: a popper throwing sparks.
function CampaignModeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M5.6 6.2 2.3 13.4l7.2-3.3z" />
            <path d="M5.6 6.2c1.3-.3 3.6 2 3.9 3.9" />
            <path d="M9.8 5.2 11.6 3.3M12.2 7.6l2.1-.5M8.3 2.9l-.3 2.2" />
            <circle cx="13.4" cy="3.6" r=".4" fill="currentColor" />
        </svg>
    );
}

const MODES: { id: Exclude<CampaignMode, "edit">; label: string; about: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { id: "campaign", label: "Campaign mode", about: "The toolbar over the selection", icon: CampaignModeIcon },
    { id: "design", label: "Design mode", about: "The full design editor", icon: DesignModeIcon },
];

// The pair at the end of the bar: the product's own mode and Design mode (which brings the design
// editor's toolbar and panel). People who may only view stay in the product's mode.
function ModeSwitch() {
    const mode = useCampaign((s) => s.mode);
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <div role="radiogroup" aria-label="Mode" className="flex gap-0.5 rounded-[6px] bg-panel-border p-0.5">
            {MODES.map((m) => {
                const on = m.id === "design" ? mode === "design" : mode !== "design";
                return (
                    <AriaTooltipTrigger key={m.id} delay={400} closeDelay={0}>
                        <AriaButton
                            aria-pressed={on}
                            aria-label={m.label}
                            isDisabled={m.id === "design" && readOnly}
                            onPress={() => {
                                if (on) return;
                                campaign.set({ mode: m.id === "campaign" && editor.get().readOnly ? "edit" : m.id });
                                editor.set({ tool: "move", editingTextId: null, rightTab: "design", mode: "design" });
                            }}
                            className={`flex size-7 items-center justify-center rounded-[5px] outline-none focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-35 ${on ? "bg-panel text-brand-300" : "text-ink hover:text-ink"}`}
                        >
                            <m.icon className="size-[18px]" />
                        </AriaButton>
                        <AriaTooltip offset={8} className="flex h-6 items-center rounded-[5px] bg-tooltip px-2 text-[11px] text-white shadow-lg ring-1 ring-[#363636]">
                            {m.label}
                            <span className="ml-2 text-white/50">{m.about}</span>
                        </AriaTooltip>
                    </AriaTooltipTrigger>
                );
            })}
        </div>
    );
}

// Move, Hand and Comment, then the modes; Design mode brings the design editor's toolbar instead.
function BottomBar() {
    const tool = useEditor((s) => s.tool);
    const mode = useCampaign((s) => s.mode);
    const set = (next: "move" | "hand" | "comment") => editor.set({ tool: next, editingTextId: null });
    if (mode === "design") return <Toolbar compact modes={<ModeSwitch />} />;
    return (
        <div role="toolbar" aria-label="Tools" className="pointer-events-auto flex h-12 items-center gap-2 rounded-[13px] bg-panel px-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_10px_rgba(0,0,0,0.3)]">
            <BarButton icon={MoveIcon} label="Move" shortcut="V" active={tool !== "hand" && tool !== "comment"} onPress={() => set("move")} />
            <BarButton icon={Hand} label="Hand" shortcut="H" active={tool === "hand"} onPress={() => set("hand")} />
            <BarButton icon={MessageCircle01} label="Comment" shortcut="C" active={tool === "comment"} onPress={() => set(tool === "comment" ? "move" : "comment")} />
            <span className="h-12 w-px bg-panel-border" />
            <ModeSwitch />
        </div>
    );
}

// The zoom pill and the round help button; Design mode keeps only the help (its zoom menu is in
// the Design panel's header).
function Zoom() {
    const round = "flex items-center justify-center text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500";
    const mode = useCampaign((s) => s.mode);
    return (
        <div className="absolute right-5 bottom-5 flex items-center gap-2">
            {mode !== "design" && (
            <div className="flex h-[30px] items-center rounded-full bg-panel shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
                <AriaButton aria-label="Zoom out" onPress={() => zoomBy(1 / 1.25)} className={`${round} h-[30px] w-8 rounded-l-full`}>
                    <Minus className="size-4" />
                </AriaButton>
                <span className="h-[30px] w-px bg-panel-border" />
                <AriaButton aria-label="Zoom in" onPress={() => zoomBy(1.25)} className={`${round} h-[30px] w-8 rounded-r-full`}>
                    <Plus className="size-4" />
                </AriaButton>
            </div>
            )}
            <AriaButton aria-label="Keyboard shortcuts and help" onPress={toggleShortcuts} className={`${round} size-8 rounded-full border border-panel-border bg-panel text-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.3)]`}>
                ?
            </AriaButton>
        </div>
    );
}

// The grid view folds the asset list into a pill: the file's name and New asset.
function GridPill() {
    const name = useEditor((s) => s.doc.name);
    const readOnly = useEditor((s) => s.readOnly);
    return (
        <div className="absolute top-3 left-3 z-10 flex h-12 items-center gap-1 rounded-[13px] bg-panel px-2 text-[11px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.25)]">
            <AriaButton aria-label="Show the asset list" onPress={() => campaign.set({ view: "asset" })} className="flex h-8 items-center gap-2 rounded-[5px] px-2 text-[13px] font-semibold text-ink outline-none hover:bg-panel-hover">
                <span className="max-w-40 truncate">{name || "Untitled"}</span>
                <ChevronDown className="size-3 text-ink-muted" />
            </AriaButton>
            {!readOnly && (
                <>
                    <span className="h-6 w-px bg-panel-border" />
                    <AriaButton onPress={() => campaign.set({ dialog: { kind: "add" } })} className="flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-ink outline-none hover:bg-panel-hover">
                        <Plus className="size-4" /> New asset
                    </AriaButton>
                </>
            )}
        </div>
    );
}

// Edit mode lets the canvas show and pick assets and their fields, not reshape them: design
// shortcuts (tools, grouping, pasting layers, nudging) are held back. Undo, zoom, comments and
// deleting whole assets work.
function useEditModeKeys() {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
            if (!inEditMode() || editor.get().editingTextId) return;
            const key = event.key.toLowerCase();
            const mod = event.metaKey || event.ctrlKey;
            const allowed = mod
                ? ["z", "y", "s", "k", "=", "-", "+", "0", "a"].includes(key)
                : key === "escape" || key === " " || key === "h" || key === "c" || key === "v" || key === "!" || key === "@" || (event.shiftKey && (key === "1" || key === "2")) || key === "shift" || key === "meta" || key === "control" || key === "alt";
            if (allowed) {
                // ⌘A in Edit mode selects every asset, not the layers inside them.
                if (mod && key === "a") {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    editor.set({ selection: assetsOf(editor.get().doc).map((a) => a.id) });
                }
                return;
            }
            // Enter on a text field starts typing in it, on the canvas.
            if (key === "enter") {
                const s = editor.get();
                const node = s.doc.nodes[s.selection[0] ?? ""];
                const data = node?.campaign?.kind === "layer" ? node.campaign : null;
                if (node && data?.type === "text" && !data.locks.content && !s.readOnly) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    editor.set({ editingTextId: node.id });
                    return;
                }
            }
            if (key === "backspace" || key === "delete") {
                const s = editor.get();
                const allAssets = s.selection.length > 0 && s.selection.every((id) => assetData(s.doc.nodes[id]));
                if (allAssets && !s.readOnly) return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
}

// The product's own keys, ahead of the design editor's: ⇧D switches between the product's mode and
// Design mode; with whole assets selected, ⌘D duplicates them into their rows and Delete removes
// them (the grid closes up); ⇧⌘E exports the selection.
function useCampaignKeys() {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable || (target instanceof Element && target.closest("[data-bulk-grid]")))) return;
            const s = editor.get();
            if (!isCampaignDoc() || s.editingTextId) return;
            const mod = event.metaKey || event.ctrlKey;
            const stop = () => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            if (event.shiftKey && !mod && !event.altKey && event.code === "KeyD") {
                stop();
                if (s.readOnly) return;
                campaign.set({ mode: campaign.get().mode === "design" ? "campaign" : "design" });
                editor.set({ tool: "move", editingTextId: null, rightTab: "design", mode: "design" });
                return;
            }
            const assets = s.selection.length > 0 && s.selection.every((id) => assetData(s.doc.nodes[id]));
            if (mod && event.shiftKey && event.code === "KeyE") {
                stop();
                campaign.set({ dialog: { kind: "export", ids: assets ? s.selection : undefined } });
                return;
            }
            if (!assets || s.readOnly) return;
            if (mod && !event.shiftKey && !event.altKey && event.code === "KeyD") {
                stop();
                duplicateAssets(s.selection);
            } else if (!mod && (event.key === "Backspace" || event.key === "Delete")) {
                stop();
                deleteAssets(s.selection);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
}

// Keeps the asset on show valid and, in the asset view (and Bulk edit's preview), the only one
// drawn, framed in the middle of the canvas.
function useAssetFocus(main: React.RefObject<HTMLElement | null>) {
    const view = useCampaign((s) => s.view);
    const panel = useCampaign((s) => s.panel);
    const current = useCampaign((s) => s.current);
    const valid = useEditor((s) => (current ? Boolean(assetData(s.doc.nodes[current])) : false));
    const selectedAsset = useEditor((s) => assetOf(s.doc, s.selection[0])?.id ?? null);
    const firstAsset = useEditor((s) => firstAssetOf(s.doc)?.id ?? null);
    // A new size (Resize, the size menu, undo) frames the asset afresh.
    const size = useEditor((s) => {
        const node = current ? s.doc.nodes[current] : undefined;
        return node ? `${node.w}x${node.h}` : "";
    });
    // The asset view shows one asset, so a selection of layers there stays inside it. Whole assets
    // (⇧-clicked in the asset list, or ⌘A) may be picked together, for Export, Duplicate or Delete.
    const spread = useEditor((s) => !s.selection.every((id) => assetData(s.doc.nodes[id])) && new Set(s.selection.map((id) => assetOf(s.doc, id)?.id)).size > 1);
    useEffect(() => {
        if (!spread || view !== "asset" || panel === "bulk") return;
        const s = editor.get();
        const keep = s.selection.filter((id) => assetOf(s.doc, id)?.id === (selectedAsset ?? current));
        // Not a step of its own: undoing a change to several assets selects them all, and narrowing
        // that here must not throw away redo.
        editor.set({ selection: keep }, { history: false });
    }, [spread, view, panel, selectedAsset, current]);
    // The asset on show follows the selection, and falls back to the first asset.
    useEffect(() => {
        if (selectedAsset && selectedAsset !== current) campaign.set({ current: selectedAsset });
        else if (!valid && firstAsset !== current) campaign.set({ current: firstAsset });
    }, [selectedAsset, valid, firstAsset, current]);
    const focused = view === "asset" || panel === "bulk";
    useEffect(() => {
        sceneFocus.id = focused && valid ? current : null;
        editor.set({});
        if (focused) frameCurrent();
        else fitAssets();
        const el = main.current;
        if (!focused || !el) return;
        const observer = new ResizeObserver(() => frameCurrent());
        observer.observe(el);
        return () => observer.disconnect();
    }, [focused, current, valid, main, size]);
    // The asset on show moving (a reorder in the list, Order, undo, a collaborator) keeps it framed.
    useEffect(() => {
        if (!focused || !valid || !current) return;
        const off = editor.onCommit((before, after) => {
            const was = before.nodes[current];
            const now = after.nodes[current];
            if (was && now && (was.x !== now.x || was.y !== now.y)) frameCurrent();
        });
        return () => void off();
    }, [focused, valid, current]);
    useEffect(
        () => () => {
            sceneFocus.id = null;
        },
        [],
    );
}

// Design mode's right side: the design editor's panel, with the file's people, Export and Share
// in its header and "Design" over the zoom menu, then the Design panel proper.
function RightSide() {
    const mode = useCampaign((s) => s.mode);
    const history = useCollab((s) => s.historyOpen);
    const commenting = useEditor((s) => s.tool === "comment");
    if (history) return <VersionHistoryPanel />;
    if (commenting) return <CommentsPanel />;
    if (mode !== "design") return null;
    return (
        <div className="flex h-full w-[240px] shrink-0 flex-col border-l border-panel-border bg-panel">
            <div className="flex h-12 shrink-0 items-center px-2">
                <TopRight inline />
            </div>
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-panel-border pr-2 pl-4 text-[11px]">
                <span className="font-semibold text-ink">Design</span>
                <ZoomMenu />
            </div>
            {/* The Design panel without its own people, Share and Design/Prototype rows. */}
            <div className="flex min-h-0 flex-1 [&_[data-right-panel]]:w-full [&_[data-right-panel]]:border-l-0 [&_[data-right-panel]>div:first-of-type]:hidden [&_[data-right-panel]>header]:hidden">
                <RightPanel />
            </div>
        </div>
    );
}

function SidePanel() {
    const panel = useCampaign((s) => s.panel);
    const view = useCampaign((s) => s.view);
    switch (panel) {
        case "templates":
            return <TemplatesPanel />;
        case "text":
            return <TextPanel />;
        case "media":
            return <MediaPanel />;
        case "inserts":
            return <InsertsPanel />;
        case "plugins":
            return <PluginsPanel />;
        case "reviews":
            return <ReviewsPanel />;
        default:
            return view === "asset" ? <AssetsPanel /> : null;
    }
}

function Toast() {
    const toast = useEditor((s) => s.toast);
    if (!toast) return null;
    return (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center">
            <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
        </div>
    );
}

function Canvas({ children }: { children?: ReactNode }) {
    const ref = useRef<HTMLElement | null>(null);
    useAssetFocus(ref);
    return (
        <main ref={ref} className="relative min-w-0 flex-1 bg-canvas">
            <ErrorBoundary name="canvas">
                <CanvasView />
            </ErrorBoundary>
            {children}
        </main>
    );
}

// For checking the campaign state from the browser console while developing (the editor is window.nagma).
if (import.meta.env.DEV) Object.assign(window, { nagmaCampaign: campaign });

export function CampaignEditor() {
    useEditModeKeys();
    useCampaignKeys();
    useReviewSync();
    const uiHidden = useEditor((s) => s.uiHidden);
    const fileId = useEditor((s) => s.fileId);
    const readOnly = useEditor((s) => s.readOnly);
    const panel = useCampaign((s) => s.panel);
    const view = useCampaign((s) => s.view);
    const mode = useCampaign((s) => s.mode);
    // A newly opened campaign starts on its first asset, in the asset view, in the product's own
    // mode (people who may only view get the fields the templates open up).
    useEffect(() => {
        campaign.set({ mode: editor.get().readOnly ? "edit" : "campaign", panel: "assets", view: "asset", current: firstAssetOf(editor.get().doc)?.id ?? null, dialog: null });
        editor.set({ mode: "design", rightTab: "design" });
    }, [fileId]);
    useEffect(() => {
        if (readOnly && campaign.get().mode !== "edit") campaign.set({ mode: "edit" });
    }, [readOnly]);
    // The product's accent (magenta) and its darker panels, on the whole window so menus and
    // dialogs pick them up too; Design mode brings the design editor's blue back.
    useEffect(() => {
        document.documentElement.dataset.product = "campaign";
        return () => {
            delete document.documentElement.dataset.product;
            delete document.documentElement.dataset.campaignMode;
        };
    }, []);
    useEffect(() => {
        document.documentElement.dataset.campaignMode = mode;
    }, [mode]);
    useEffect(() => () => campaign.set({ dialog: null }), []);
    const bulk = panel === "bulk" && !readOnly;
    return (
        <div className="flex min-h-0 w-full flex-1 bg-canvas" data-campaign>
            {!uiHidden && <Rail />}
            {bulk ? (
                <div className="flex min-w-0 flex-1 flex-col">
                    <header className="flex h-12 shrink-0 items-center justify-between border-b border-panel-border bg-panel pr-2 pl-4">
                        <BulkHeader />
                        <TopRight inline />
                    </header>
                    <div className="flex min-h-0 flex-1">
                        <BulkTable />
                        <Canvas>
                            <AriaButton aria-label="Close bulk edit" onPress={() => campaign.set({ panel: "assets" })} className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                                <X className="size-4" />
                            </AriaButton>
                            <Zoom />
                            <Toast />
                        </Canvas>
                    </div>
                </div>
            ) : (
                <>
                    {!uiHidden && <SidePanel />}
                    {!uiHidden && panel !== "assets" && view === "asset" && <AssetStrip />}
                    <Canvas>
                        <EmptyState />
                        {!uiHidden && (
                            <>
                                {mode !== "design" && <ContextToolbar />}
                                {view === "grid" && panel === "assets" && <GridPill />}
                                {mode !== "design" && (
                                    <div className="absolute top-3 right-3 z-10" data-campaign-topright="">
                                        <TopRight />
                                    </div>
                                )}
                                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
                                    <FloatingBars />
                                    <BottomBar />
                                </div>
                                <Zoom />
                            </>
                        )}
                        <Toast />
                    </Canvas>
                    {!uiHidden && <RightSide />}
                </>
            )}
            <CampaignDialogs />
            <CampaignContextMenu />
            <ActionsPalette />
            <ShortcutsPanel />
            <NamePrompt />
            <SaveVersionDialog />
        </div>
    );
}

// A new campaign opens on a template picker: the starter layouts in a size, a blank asset, the
// team's templates and frames from a design file.
function EmptyState() {
    const empty = useEditor((s) => assetsOf(s.doc).length === 0);
    const readOnly = useEditor((s) => s.readOnly);
    const [size, setSize] = useState("square");
    const [busy, setBusy] = useState<string | null>(null);
    if (!empty || readOnly) return null;
    const preset = presetFor(size) ?? SIZE_PRESETS[0];
    const row = () => rowsOf(editor.get().doc)[0]?.row.id ?? addRow();
    return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto w-[520px] rounded-xl border border-panel-border bg-panel p-5 shadow-lg" role="dialog" aria-label="Start your campaign">
                <div className="mb-1 flex items-center gap-2">
                    <LayoutAlt04 className="size-4 text-ink-muted" />
                    <span className="text-[13px] font-semibold text-ink">Start your campaign</span>
                    <select aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)} className="ml-auto h-6 rounded-[5px] border border-panel-border bg-panel px-1.5 text-[11px] text-ink outline-none">
                        {SIZE_GROUPS.map((g) => (
                            <optgroup key={g} label={g}>
                                {SIZE_PRESETS.filter((p) => p.group === g).map((p) => (
                                    <option key={p.id} value={p.id}>{`${p.label} ${p.w}x${p.h}`}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>
                <p className="mb-3 text-[11px] text-ink-muted">Pick a template to start from. Open up the fields editors may change, then make every size and variation from it.</p>
                <div className="grid grid-cols-5 gap-2">
                    {STARTER_LAYOUTS.map((l) => (
                        <button
                            key={l.id}
                            type="button"
                            disabled={busy !== null}
                            title={l.about}
                            onClick={() => {
                                setBusy(l.id);
                                void addStarterTemplate(row(), size, l.id).finally(() => setBusy(null));
                            }}
                            className="flex flex-col overflow-hidden rounded-md bg-field text-left outline-none hover:ring-1 hover:ring-brand-500 focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-50"
                        >
                            <StarterPicture layout={l.id} w={preset?.w ?? 1080} h={preset?.h ?? 1080} />
                            <span className="truncate px-1.5 py-1 text-[10px] text-ink">{busy === l.id ? "Adding…" : l.label}</span>
                        </button>
                    ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => addBlankAsset(size, row())} className="h-7 rounded-[6px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover">Blank asset</button>
                    <button type="button" onClick={() => campaign.set({ panel: "templates" })} className="h-7 rounded-[6px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover">Your team's templates</button>
                    <button type="button" onClick={() => campaign.set({ dialog: { kind: "import" } })} className="h-7 rounded-[6px] border border-panel-border text-[11px] text-ink hover:bg-panel-hover">From a design file</button>
                </div>
            </div>
        </div>
    );
}

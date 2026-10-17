import { createContext, useContext, useEffect, useState } from "react";
import { Box, File06, LayoutLeft, PlusCircle, SearchSm, Stars01, Target02, Tool02 } from "@untitledui/icons";
import { useLibraryUpdates } from "../engine/library";
import { AgentPanel } from "./agent-panel";
import { AssetsPanel } from "./assets-panel";
import { ToolsPanel } from "./tools-panel";
import {
    Button as AriaButton,
    Menu as AriaMenu,
    MenuItem as AriaMenuItem,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Separator as AriaSeparator,
    SubmenuTrigger as AriaSubmenuTrigger,
    Switch as AriaSwitch,
} from "react-aria-components";
import { ACTION_BY_ID, MAIN_MENU, type MenuNode, actionEnabled, actionLabel, runAction } from "../engine/menu-actions";
import { type LeftPanel, type Prefs, editor, useEditor } from "../engine/store";
import { IconButton } from "./icon-button";
import { FileHeader, LayersPanel } from "./layers-panel";
import { NagmaLogo } from "./nagma-logo";
import { MoveToPageSubmenu } from "./move-to-page-menu";

const RAIL: { id: LeftPanel; label: string; icon: typeof Box }[] = [
    { id: "layers", label: "File", icon: File06 },
    { id: "agents", label: "Agents", icon: Stars01 },
    { id: "assets", label: "Assets", icon: PlusCircle },
    { id: "tools", label: "Tools", icon: Tool02 },
    { id: "variables", label: "Variables", icon: Target02 },
];

export function LeftSidebar() {
    const prefs = useEditor((s) => s.prefs);
    // The blue dot on Assets while libraries this file uses have updates.
    const libraryUpdates = useLibraryUpdates().updates.length;

    const choose = (id: LeftPanel) => {
        // Clicking the open panel's icon collapses it, like the other design tools.
        if (prefs.leftPanel === id && prefs.leftPanelOpen) editor.setPrefs({ leftPanelOpen: false });
        else editor.setPrefs({ leftPanel: id, leftPanelOpen: true });
    };

    // View › Minimize left navigation bar: the rail folds away while the panel is open (the main
    // menu moves into the panel's header); with the panel closed the rail stays to reopen it.
    const railHidden = prefs.railMinimized && prefs.leftPanelOpen && prefs.leftPanel !== "variables";
    return (
        <>
            {prefs.memoryUsage && <MemoryUsage />}
            {!railHidden && (
            <nav aria-label="Panels" className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-panel-border bg-panel py-2">
                <MainMenu />
                <div className="h-px w-6 bg-panel-border" />
                {RAIL.map(({ id, label, icon }, i) => (
                    <div key={id} className="contents">
                        {i === RAIL.length - 1 && <div className="h-px w-6 bg-panel-border" />}
                        <span className="relative">
                            <IconButton icon={icon} label={id === "assets" && libraryUpdates ? `${label}, library updates available` : label} active={prefs.leftPanelOpen && prefs.leftPanel === id} onPress={() => choose(id)} />
                            {id === "assets" && libraryUpdates > 0 && <span aria-hidden className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-brand-500 ring-2 ring-panel" />}
                        </span>
                    </div>
                ))}
            </nav>
            )}
            {prefs.leftPanelOpen && prefs.leftPanel !== "variables" && (
                <aside data-region="left" className="flex h-full w-60 shrink-0 flex-col border-r border-panel-border bg-panel">
                    {(prefs.leftPanel === "layers" || prefs.leftPanel === "history" || prefs.leftPanel === "settings") && (
                        <FileHeader lead={railHidden ? <MainMenu /> : undefined} actions={<IconButton size="sm" icon={LayoutLeft} label="Collapse panel" onPress={() => editor.setPrefs({ leftPanelOpen: false })} />} />
                    )}
                    {prefs.leftPanel === "layers" && <LayersPanel />}
                    {prefs.leftPanel === "agents" && <AgentPanel />}
                    {prefs.leftPanel === "assets" && <AssetsPanel />}
                    {prefs.leftPanel === "tools" && <ToolsPanel />}
                    {prefs.leftPanel === "settings" && <SettingsPanel />}
                </aside>
            )}
        </>
    );
}

// View › Memory usage: the page's JavaScript heap, where the browser reports it.
function MemoryUsage() {
    const [used, setUsed] = useState<number | null>(null);
    useEffect(() => {
        const read = () => setUsed((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
        read();
        const timer = window.setInterval(read, 2000);
        return () => window.clearInterval(timer);
    }, []);
    return (
        <div role="status" className="pointer-events-none fixed bottom-2 left-14 z-40 rounded-md bg-tooltip px-2 py-1 text-[11px] text-white/80 tabular-nums">
            {used === null ? "Memory: not reported here" : `Memory: ${Math.round(used / 1048576)} MB`}
        </div>
    );
}

function MainMenu() {
    return (
        <AriaMenuTrigger>
            <AriaButton
                aria-label="Main menu"
                className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500"
            >
                <NagmaLogo size={20} />
            </AriaButton>
            <AriaPopover placement="bottom start" offset={4} crossOffset={-4} className={`w-[211px] ${MAIN_MENU_CLASS}`}>
                <DenseMenu>
                    <MenuLevel nodes={MAIN_MENU} />
                </DenseMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The main menu and its submenus: 24pt rows inset 8 on #1E1E1E (dark in both themes), 8pt group
// rules, the Actions… row 32 tall.
const MAIN_MENU_CLASS = "rounded-[13px] bg-tooltip px-2 pt-1 pb-2 text-white shadow-xl outline-none";
const SUB_MENU_CLASS = `w-max min-w-[190px] max-w-[320px] ${MAIN_MENU_CLASS} pt-2`;

// Menus built from the action table (and the file-name menu) use 24pt rows; other menus keep their own.
const DenseContext = createContext(false);
export function DenseMenu({ children }: { children: React.ReactNode }) {
    return <DenseContext.Provider value>{children}</DenseContext.Provider>;
}

// One level of the main menu, built from the shared action table (engine/menu-actions.ts).
function MenuLevel({ nodes, label = "Main menu" }: { nodes: MenuNode[]; label?: string }) {
    const s = useEditor((state) => state);
    const disabled = nodes.flatMap((node) => {
        if (typeof node !== "string") return [];
        const action = ACTION_BY_ID.get(node);
        return action && !actionEnabled(action, s) ? [node] : [];
    });
    return (
        <AriaMenu aria-label={label} className="outline-none" disabledKeys={disabled} onAction={(key) => runAction(String(key))}>
            {nodes.map((node, i) => {
                if (node === "-") return <AriaSeparator key={`sep-${i}`} className={`-mx-2 h-px bg-white/10 ${nodes[i - 1] === "actions" ? "mt-1 mb-2" : "my-2"}`} />;
                if (node === "moveToPage") return s.selection.length ? <MoveToPageSubmenu key="moveToPage" menuClass={SUB_MENU_CLASS} /> : null;
                if (typeof node !== "string") {
                    return (
                        <AriaSubmenuTrigger key={node.sub}>
                            <MenuRow id={node.sub} label={node.label} shortcut="›" />
                            <AriaPopover offset={4} crossOffset={-8} className={`${SUB_MENU_CLASS} max-h-[80vh] overflow-y-auto`}>
                                <MenuLevel nodes={node.items} label={node.label} />
                            </AriaPopover>
                        </AriaSubmenuTrigger>
                    );
                }
                const action = ACTION_BY_ID.get(node);
                if (!action) return null;
                return <MenuRow key={node} id={node} label={actionLabel(action, s)} shortcut={action.shortcut} checked={action.checked?.(s)} icon={node === "actions" ? SearchSm : undefined} />;
            })}
        </AriaMenu>
    );
}

export function MenuRow({
    id,
    label,
    shortcut,
    icon: Icon,
    checked,
}: {
    id: string;
    label: string;
    shortcut?: string;
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    checked?: boolean;
}) {
    const dense = useContext(DenseContext);
    // The Actions… row is 32 tall; the rest 24 in the main menu, 28 elsewhere.
    const height = dense ? (id === "actions" ? "h-8" : "h-6") : "h-7";
    return (
        <AriaMenuItem
            id={id}
            className={`flex ${height} cursor-default items-center justify-between ${dense ? "gap-3" : "gap-4"} rounded px-2 text-[11px] outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500`}
        >
            <span className={`flex min-w-0 items-center whitespace-nowrap ${dense ? "gap-1" : "gap-2"}`}>
                {checked !== undefined && <span className="w-3 text-center">{checked ? "✓" : ""}</span>}
                {Icon && <Icon className="size-3.5" />}
                {label}
            </span>
            {shortcut && <span className="shrink-0 whitespace-nowrap text-white/50">{shortcut}</span>}
        </AriaMenuItem>
    );
}


const isDesktop = typeof window !== "undefined" && Boolean((window as unknown as { nagmaDesktop?: unknown }).nagmaDesktop);

function SettingsPanel() {
    const prefs = useEditor((s) => s.prefs);
    const toggle = (label: string, key: keyof Prefs) => (
        <AriaSwitch
            key={key}
            isSelected={Boolean(prefs[key])}
            onChange={(on) => editor.setPrefs({ [key]: on } as Partial<Prefs>)}
            className="group flex h-7 cursor-default items-center justify-between outline-none"
        >
            <span>{label}</span>
            <span className="flex h-4 w-7 items-center rounded-full bg-panel-border p-0.5 transition-colors group-data-[selected]:bg-brand-500">
                <span className="size-3 rounded-full bg-white transition-transform group-data-[selected]:translate-x-3" />
            </span>
        </AriaSwitch>
    );
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <h3 className="mb-2 font-semibold">Appearance</h3>
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-field p-0.5">
                {(["dark", "light"] as const).map((theme) => (
                    <button
                        key={theme}
                        type="button"
                        onClick={() => editor.setPrefs({ theme })}
                        className={`h-7 rounded font-medium capitalize ${prefs.theme === theme ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                    >
                        {theme}
                    </button>
                ))}
            </div>
            <h3 className="mb-2 font-semibold">View</h3>
            {toggle("Rulers", "rulers")}
            {toggle("Pixel grid (from 800%)", "pixelGrid")}
            {toggle("Layout guides", "layoutGuides")}
            {toggle("Outlines", "outlines")}
            {toggle("Pixel preview", "pixelPreview")}
            {toggle("Multiplayer cursors", "multiplayerCursors")}
            <h3 className="mt-4 mb-2 font-semibold">Snapping</h3>
            {toggle("Snap to objects", "snapToObjects")}
            {toggle("Snap to pixel grid", "snapToPixel")}
            {toggle("Snap to geometry", "snapToGeometry")}
            <h3 className="mt-4 mb-2 font-semibold">Navigation</h3>
            {toggle("Use scroll wheel zoom", "scrollZoom")}
            {toggle("Right-click and drag to pan", "rightClickPan")}
            {toggle("Invert zoom direction", "invertZoom")}
            <h3 className="mt-4 mb-2 font-semibold">Behaviour</h3>
            {toggle("Keep tool selected after use", "keepTool")}
            {toggle("Rename duplicated layers", "renameDuplicates")}
            {toggle("Hide canvas UI during changes", "hideUiDuringChanges")}
            {toggle("Flip objects while resizing", "flipWhileResizing")}
            {toggle("Highlight layers on hover", "highlightHover")}
            {toggle("Show dimensions on objects", "showDimensions")}
            {toggle("Use number keys for opacity", "numberKeysOpacity")}
            {toggle("Smart symbols", "smartSymbols")}
            {!isDesktop && toggle("Open links in the desktop app", "openLinksInDesktop")}
            <h3 className="mt-4 mb-2 font-semibold">Color profile</h3>
            {toggle("Color management (use the file's profile)", "colorManaged")}
            <h3 id="settings-accessibility" className="mt-4 mb-2 font-semibold">Accessibility</h3>
            {toggle("Always show focus rings", "alwaysFocusRings")}
            {toggle("Reduce motion", "reduceMotion")}
            <h3 className="mt-4 mb-2 font-semibold">Nudge amount</h3>
            <div className="grid grid-cols-2 gap-2">
                <label className="flex h-7 items-center gap-2 rounded-md bg-field px-2 text-ink-muted">
                    Small
                    <input type="number" min={0.1} step={1} value={prefs.nudgeSmall} onChange={(e) => editor.setPrefs({ nudgeSmall: Math.max(0.1, Number(e.target.value) || 1) })} aria-label="Small nudge" className="w-full bg-transparent text-right text-ink outline-none" />
                </label>
                <label className="flex h-7 items-center gap-2 rounded-md bg-field px-2 text-ink-muted">
                    Big
                    <input type="number" min={0.1} step={1} value={prefs.nudgeBig} onChange={(e) => editor.setPrefs({ nudgeBig: Math.max(0.1, Number(e.target.value) || 10) })} aria-label="Big nudge" className="w-full bg-transparent text-right text-ink outline-none" />
                </label>
            </div>
        </div>
    );
}

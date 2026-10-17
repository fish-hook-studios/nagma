import { ChevronDown, DotsHorizontal, Plus, SearchSm, X } from "@untitledui/icons";
import { useEffect, useState } from "react";
import {
    Button as AriaButton,
    Dialog as AriaDialog,
    Menu as AriaMenu,
    MenuTrigger as AriaMenuTrigger,
    Modal as AriaModal,
    ModalOverlay as AriaModalOverlay,
    Popover as AriaPopover,
    Separator as AriaSeparator,
    SubmenuTrigger as AriaSubmenuTrigger,
} from "react-aria-components";
import { CanvasView } from "../canvas/canvas-view";
import { keys } from "../canvas/keys";
import { ActionsPalette } from "../components/actions-palette";
import { BoardSidePanel } from "../components/board-side-panel";
import { NamePrompt } from "../components/collab-ui";
import { ErrorBoundary } from "../components/error-boundary";
import { PresenceAvatars } from "../components/follow-ui";
import { MenuRow } from "../components/left-sidebar";
import { NagmaLogo } from "../components/nagma-logo";
import { ShareDialogContent } from "../components/share-dialog";
import { SaveVersionDialog } from "../components/version-history";
import { addPage, deletePage, viewCenter } from "../engine/actions";
import { pickImages } from "../engine/images";
import { createFile, openFile, renameFile } from "../engine/files";
import { ACTION_BY_ID, actionEnabled, actionLabel, runAction } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import type { Tool } from "../engine/types";
import { addAdjacent, addSibling, askLink, formatForKey, formatText, linkForKey, parseTable, placeShape, placeSticky, placeTable, startEditing } from "./actions";
import { hasCopiedLayers } from "../engine/layer-clipboard";
import { clipboardFiles, htmlImageSources, isImageUrl } from "../engine/paste-images";
import { BoardToolbar, ShapesPanel, TOOL_DRAG } from "./board-toolbar";
import { screenToWorld, zoomTo } from "../engine/camera";
import { SHAPE_SIZE } from "./model";
import { PlaceBar } from "../components/place-bar";
import { BoardExportDialog } from "./export-dialog";
import { BoardContextMenu } from "./context-menu";
import { BoardZoom, Recenter } from "./zoom";
import { linkFrom, placeLink } from "./links";
import { ungroupSelection } from "../engine/actions";
import { useVectorUi, vectorUi } from "../engine/vector-ui";
import { ContextBar } from "./context-bar";
import { BOARD_TEMPLATES, TEMPLATE_CATEGORIES, insertTemplate } from "./templates";
import { deleteSavedTemplate, insertSavedTemplate, saveSelectionAsTemplate, savedTemplates, subscribeSaved } from "./custom-templates";
import { type TeamTemplate, createTeamTemplate, loadTeamTemplates, startFromTemplate } from "../engine/team-templates";
import { useTeams } from "../engine/teams";
import { BoardTextEditor } from "./text-edit";
import { BoardEmbeds, MaximizedEmbed } from "./embeds";
import { SectionTitleEditor } from "./section-title";
import { TextLayerMentions } from "./mention-list";
import { StampWheel } from "./stamp-wheel";
import { openWheel } from "./stamps";
import { VotingInvite } from "./voting-ui";
import { MeetingsButton, MeetingsPanel } from "./meetings";
import { AudioButton, Captions } from "./audio-ui";
import { type BoardTool, board, setBoardTool, useBoard } from "./state";
import "./paint";
import "./connectors";
import "./voting";
import "./sticky";
import { tableKey } from "./plugin";
import { pickedRange, styleCells } from "./table";
import { askText } from "../components/ask-text";

// The whiteboard editor: the canvas on a dotted board, the floating pills at the top (main menu,
// file name, pages; people, templates, timer, Share), the toolbar along the bottom, zoom and help
// at the bottom right, and the bar above the selection. No rulers, layers or properties panels.

// The floating pills: 48 high, white, a soft edge shadow (the file pill, the top-right cluster).
const pill = "pointer-events-auto flex h-12 items-center rounded-[13px] bg-white text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)]";
const pillButton = "flex h-8 items-center gap-1 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/5";

type Item = { id: string; label: string; shortcut?: string; run: () => void; checked?: () => boolean };
type Node = string | "-" | { sub: string; label: string; items: Node[] };

const BOARD_ITEMS: Item[] = [
    { id: "boardNew", label: "New board", run: () => void openFile(createFile("board").id) },
    { id: "boardDotGrid", label: "Show dot grid", run: () => board.set({ dotGrid: !board.get().dotGrid }), checked: () => board.get().dotGrid },
    {
        id: "boardUnlockAll",
        label: "Unlock all objects",
        run: () => {
            const s = editor.get();
            const locked = Object.values(s.doc.nodes).filter((n) => n.locked);
            if (locked.length) editor.execute({ type: "batch", commands: locked.map((n) => ({ type: "node.update" as const, id: n.id, patch: { locked: false } })) });
        },
    },
    { id: "boardExport", label: "Export…", shortcut: "⇧ ⌘ E", run: () => board.set({ exportOpen: true }) },
    { id: "boardZoom50", label: "Zoom to 50%", run: () => zoomTo(0.5) },
    { id: "boardZoom200", label: "Zoom to 200%", run: () => zoomTo(2) },
    { id: "boardTimer", label: "Timer and music", run: () => board.set({ meetings: "timer" }) },
    { id: "boardVoting", label: "Voting session…", run: () => board.set({ meetings: "voting" }) },
    { id: "boardTemplates", label: "Templates…", run: () => board.set({ templatesOpen: true }) },
    { id: "boardShortcuts", label: "Keyboard shortcuts", run: () => board.set({ helpOpen: true }) },
    { id: "boardScrollZoom", label: "Use scroll wheel zoom", run: () => editor.setPrefs({ scrollZoom: !editor.get().prefs.scrollZoom }), checked: () => editor.get().prefs.scrollZoom },
    { id: "boardRightPan", label: "Right-click and drag to pan", run: () => editor.setPrefs({ rightClickPan: !editor.get().prefs.rightClickPan }), checked: () => editor.get().prefs.rightClickPan },
    { id: "boardKeepTool", label: "Keep tool selected after use", run: () => editor.setPrefs({ keepTool: !editor.get().prefs.keepTool }), checked: () => editor.get().prefs.keepTool },
];
const ITEM_BY_ID = new Map(BOARD_ITEMS.map((i) => [i.id, i]));

const BOARD_MENU: Node[] = [
    "actions",
    "home",
    "-",
    { sub: "file", label: "File", items: ["boardNew", "-", "place", "duplicateFile", "save", "-", "saveVersion", "history", "-", "boardExport"] },
    { sub: "edit", label: "Edit", items: ["undo", "redo", "-", "copy", "cut", "paste", "pasteOver", "pasteReplace", "duplicate", "delete", "-", "find", "-", "selectAll", "selectNone", "selectInverse"] },
    { sub: "view", label: "View", items: ["boardDotGrid", "comments", "minimize", "hideUi", "cursors", "-", "zoomIn", "zoomOut", "zoom100", "boardZoom50", "boardZoom200", "fit", "zoomSelection"] },
    { sub: "object", label: "Object", items: ["group", "ungroup", "section", "toSection", "-", "front", "forward", "backward", "back", "-", "flipx", "flipy", "rotL", "rotR", "-", "lock", "boardUnlockAll"] },
    { sub: "text", label: "Text", items: ["bold", "italic", "underline", "strike", "link", "-", "bullets", "numbers", "-", "alignL", "alignC", "alignR"] },
    { sub: "arrange", label: "Arrange", items: ["aLeft", "aH", "aRight", "aTop", "aV", "aBottom", "-", "tidy", "distH", "distV"] },
    { sub: "widgets", label: "Widgets", items: ["boardTimer", "boardVoting", "boardTemplates"] },
    { sub: "prefs", label: "Preferences", items: ["boardScrollZoom", "boardRightPan", "boardKeepTool"] },
    { sub: "help", label: "Help", items: ["boardShortcuts"] },
];

const MENU_CLASS = "w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

function MenuLevel({ nodes, label }: { nodes: Node[]; label: string }) {
    const s = useEditor((state) => state);
    useBoard((b) => b.dotGrid);
    const disabled = nodes.flatMap((node) => {
        if (typeof node !== "string") return [];
        const action = ACTION_BY_ID.get(node);
        return action && !actionEnabled(action, s) ? [node] : [];
    });
    return (
        <AriaMenu aria-label={label} className="outline-none" disabledKeys={disabled} onAction={(key) => (ITEM_BY_ID.get(String(key))?.run ?? (() => runAction(String(key))))()}>
            {nodes.map((node, i) => {
                if (node === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                if (typeof node !== "string") {
                    return (
                        <AriaSubmenuTrigger key={node.sub}>
                            <MenuRow id={node.sub} label={node.label} shortcut="›" />
                            <AriaPopover offset={-4} className={`${MENU_CLASS} max-h-[80vh] overflow-y-auto`}>
                                <MenuLevel nodes={node.items} label={node.label} />
                            </AriaPopover>
                        </AriaSubmenuTrigger>
                    );
                }
                const item = ITEM_BY_ID.get(node);
                if (item) return <MenuRow key={node} id={node} label={item.label} shortcut={item.shortcut} checked={item.checked?.()} />;
                const action = ACTION_BY_ID.get(node);
                if (!action) return null;
                return <MenuRow key={node} id={node} label={node === "section" ? "Wrap in new section" : node === "toSection" ? "Convert to section" : actionLabel(action, s)} shortcut={action.shortcut} checked={action.checked?.(s)} />;
            })}
        </AriaMenu>
    );
}

function FileName() {
    const name = useEditor((s) => s.doc.name);
    const fileId = useEditor((s) => s.fileId);
    const [editing, setEditing] = useState(false);
    if (editing) {
        return (
            <input
                autoFocus
                aria-label="File name"
                defaultValue={name}
                onBlur={(e) => {
                    setEditing(false);
                    const next = e.target.value.trim();
                    if (next && next !== name) {
                        if (fileId) renameFile(fileId, next);
                        else editor.execute({ type: "doc.rename", name: next });
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(false);
                }}
                className="h-8 w-44 rounded-lg border border-[#9747FF] px-2 text-[12px] outline-none"
            />
        );
    }
    // Clicking the name opens the file's settings; double-clicking renames it straight away.
    const settings: Item[] = [
        { id: "fileRename", label: "Rename", run: () => setEditing(true) },
        { id: "duplicateFile", label: "Duplicate", run: () => runAction("duplicateFile") },
        { id: "saveVersion", label: "Save to version history", run: () => runAction("saveVersion") },
        { id: "history", label: "Show version history", run: () => runAction("history") },
        { id: "boardExport", label: "Export…", shortcut: "⇧ ⌘ E", run: () => board.set({ exportOpen: true }) },
    ];
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="File settings" onDoubleClick={() => setEditing(true)} className={`${pillButton} mr-2 max-w-48 text-[13px] font-semibold`}>
                <span className="truncate">{name || "Untitled"}</span>
            </AriaButton>
            <AriaPopover placement="bottom start" offset={6} className={MENU_CLASS}>
                <AriaMenu aria-label="File settings" className="outline-none" onAction={(key) => settings.find((i) => i.id === key)?.run()}>
                    {settings.map((i) => (
                        <MenuRow key={i.id} id={i.id} label={i.label} shortcut={i.shortcut} />
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// The pages popover: 200 wide under the page button, a "Pages" header with "+", 32pt rows, the
// current page tinted with a "…" menu (rename, delete).
function PagesPanel({ left }: { left: number }) {
    const open = useBoard((s) => s.pagesPanel);
    const roots = useEditor((s) => s.doc.roots);
    const nodes = useEditor((s) => s.doc.nodes);
    const pages = roots.map((id) => nodes[id]).filter((n) => n && !n.internal);
    const current = useEditor((s) => s.pageId);
    if (!open) return null;
    const rename = async (id: string, name: string) => {
        const next = (await askText("Rename page", name))?.trim();
        if (next && next !== name) editor.execute({ type: "node.update", id, patch: { name: next } });
    };
    return (
        <div className="pointer-events-auto absolute top-[68px] z-10 w-[200px] rounded-[13px] bg-white px-2 pb-2 text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_5px_14px_rgba(0,0,0,0.1)]" style={{ left }} aria-label="Pages">
            <div className="flex h-10 items-center justify-between pl-2">
                <span className="text-[12px] font-medium">Pages</span>
                <button type="button" aria-label="Add page" onClick={addPage} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-black/5"><Plus className="size-4" /></button>
            </div>
            {pages.map((p) =>
                p ? (
                    <div key={p.id} className={`group flex h-8 items-center rounded-[5px] ${p.id === current ? "bg-[#EFE6FD]" : ""}`}>
                        <button type="button" onClick={() => editor.setPage(p.id)} className={`h-8 min-w-0 flex-1 truncate px-2 text-left text-[12px] ${p.id === current ? "font-medium" : ""}`}>
                            {p.name}
                        </button>
                        {p.id === current && (
                            <AriaMenuTrigger>
                                <AriaButton aria-label="Page options" className="mr-1 flex size-6 items-center justify-center rounded-[5px] outline-none hover:bg-black/5">
                                    <DotsHorizontal className="size-4" />
                                </AriaButton>
                                <AriaPopover placement="bottom start" offset={4} className={MENU_CLASS}>
                                    <AriaMenu aria-label="Page options" className="outline-none" onAction={(key) => (key === "rename" ? void rename(p.id, p.name) : void deletePage(p.id))} disabledKeys={pages.length <= 1 ? ["delete"] : []}>
                                        <MenuRow id="rename" label="Rename" />
                                        <MenuRow id="delete" label="Delete" />
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaMenuTrigger>
                        )}
                    </div>
                ) : null,
            )}
        </div>
    );
}

function ShareBoard() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="h-8 w-[52px] rounded-[5px] bg-[#9747FF] text-[11px] font-semibold text-white outline-none hover:bg-[#8638E5]">Share</button>
            <AriaModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
                <AriaModal className="w-[480px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                    <AriaDialog className="outline-none" aria-label="Share">
                        <ShareDialogContent close={() => setOpen(false)} />
                    </AriaDialog>
                </AriaModal>
            </AriaModalOverlay>
        </>
    );
}

function TemplatesModal() {
    const open = useBoard((s) => s.templatesOpen);
    const into = useBoard((s) => s.templatesInto);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<(typeof TEMPLATE_CATEGORIES)[number] | "Yours" | "Team">("All");
    const close = () => board.set({ templatesOpen: false, templatesInto: null });
    const q = query.trim().toLowerCase();
    const list = category === "Yours" || category === "Team" ? [] : BOARD_TEMPLATES.filter((t) => (category === "All" || t.category === category) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)));
    // Your own templates (saved selections) and the teams' board templates.
    const [, setSavedTick] = useState(0);
    useEffect(() => subscribeSaved(() => setSavedTick((n) => n + 1)), []);
    const saved = savedTemplates().filter((t) => (category === "All" || category === "Yours") && (!q || t.name.toLowerCase().includes(q)));
    const teams = useTeams();
    const [team, setTeam] = useState<{ teamId: string; template: TeamTemplate }[]>([]);
    useEffect(() => {
        if (!open || category !== "Team") return;
        let live = true;
        void Promise.all(teams.map((t) => loadTeamTemplates(t.id).then((list) => list.filter((x) => x.kind === "board").map((template) => ({ teamId: t.id, template }))).catch(() => []))).then((all) => live && setTeam(all.flat()));
        return () => {
            live = false;
        };
    }, [open, category, teams]);
    const hasSelection = useEditor((s) => s.selection.length > 0);
    // Naming a template being saved (your own, or published to a team), in a field in the dialog.
    const [naming, setNaming] = useState<{ team: string | null; name: string } | null>(null);
    const saveSelection = (name: string) => {
        if (saveSelectionAsTemplate(name)) setCategory("Yours");
    };
    const publish = async (teamId: string, name: string) => {
        try {
            await createTeamTemplate(teamId, { doc: editor.get().doc, kind: "board", name });
            editor.notify("Published to the team's templates");
            setCategory("Team");
        } catch (error) {
            editor.notify(error instanceof Error ? error.message : "Couldn't publish the template.");
        }
    };
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => (o ? board.set({ templatesOpen: true }) : close())} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <AriaModal className="w-[720px] rounded-2xl bg-white p-5 text-[#1E1E1E] shadow-2xl outline-none">
                <AriaDialog aria-label="Templates" className="outline-none">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-[16px] font-semibold">{into ? "Fill the section with a template" : "Templates"}</h2>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 hover:bg-black/5"><X className="size-4" /></button>
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                        <label className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-black/5 px-2.5">
                            <SearchSm className="size-3.5 text-black/50" />
                            <input autoFocus aria-label="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
                        </label>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-1">
                        {[...TEMPLATE_CATEGORIES, "Yours" as const, "Team" as const].map((c) => (
                            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`h-7 rounded-full px-3 text-[12px] ${category === c ? "bg-[#1E1E1E] text-white" : "bg-black/5 hover:bg-black/10"}`}>{c === "Yours" ? "Your templates" : c === "Team" ? "Team templates" : c}</button>
                        ))}
                        <span className="ml-auto flex gap-1">
                            <button type="button" disabled={!hasSelection} onClick={() => setNaming({ team: null, name: "My template" })} className="h-7 rounded-full bg-black/5 px-3 text-[12px] hover:bg-black/10 disabled:opacity-40">Save selection as template</button>
                            {teams.filter((t) => t.role && t.role !== "view").slice(0, 1).map((t) => (
                                <button key={t.id} type="button" onClick={() => setNaming({ team: t.id, name: editor.get().doc.name || "Board template" })} className="h-7 rounded-full bg-black/5 px-3 text-[12px] hover:bg-black/10">Publish board to {t.name}</button>
                            ))}
                        </span>
                    </div>
                    {naming && (
                        <form
                            className="mb-4 flex items-center gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (naming.team) void publish(naming.team, naming.name);
                                else saveSelection(naming.name);
                                setNaming(null);
                            }}
                        >
                            <input autoFocus aria-label="Template name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} onFocus={(e) => e.currentTarget.select()} className="h-8 flex-1 rounded-lg border border-[#9747FF] px-2.5 text-[12px] outline-none" />
                            <button type="button" onClick={() => setNaming(null)} className="h-8 rounded-lg px-3 text-[12px] hover:bg-black/5">Cancel</button>
                            <button type="submit" className="h-8 rounded-lg bg-[#9747FF] px-3 text-[12px] font-semibold text-white hover:bg-[#8638E5]">{naming.team ? "Publish" : "Save"}</button>
                        </form>
                    )}
                    <div className="grid max-h-[56vh] grid-cols-3 gap-3 overflow-y-auto">
                        {list.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                    close();
                                    insertTemplate(t, into ?? undefined);
                                }}
                                className="flex flex-col gap-1.5 rounded-xl border border-black/10 p-3 text-left hover:border-[#9747FF]"
                            >
                                <span className="flex h-20 items-center justify-center gap-2 rounded-lg bg-[#F5F5F5]">
                                    {t.colors.map((c) => (
                                        <span key={c} className="size-9 rounded-sm shadow-sm" style={{ background: c }} />
                                    ))}
                                </span>
                                <span className="text-[13px] font-semibold">{t.name}</span>
                                <span className="text-[11px] text-black/45">{t.category}</span>
                                <span className="text-[11.5px] text-black/60">{t.description}</span>
                            </button>
                        ))}
                        {saved.map((t) => (
                            <div key={t.id} className="group relative flex flex-col gap-1.5 rounded-xl border border-black/10 p-3 text-left hover:border-[#9747FF]">
                                <button type="button" onClick={() => { close(); insertSavedTemplate(t); }} className="flex flex-col gap-1.5 text-left">
                                    <span className="flex h-20 items-center justify-center gap-2 rounded-lg bg-[#F5F5F5]">
                                        {(t.colors.length ? t.colors : ["#E6E6E6"]).map((c) => (
                                            <span key={c} className="size-9 rounded-sm shadow-sm" style={{ background: c }} />
                                        ))}
                                    </span>
                                    <span className="text-[13px] font-semibold">{t.name}</span>
                                    <span className="text-[11px] text-black/45">Your template · {t.nodes.filter((n) => n.parentId === null).length} objects</span>
                                </button>
                                <button type="button" aria-label={`Delete ${t.name}`} onClick={() => deleteSavedTemplate(t.id)} className="absolute right-2 top-2 hidden rounded bg-white p-1 shadow group-hover:block hover:bg-black/5"><X className="size-3.5" /></button>
                            </div>
                        ))}
                        {category === "Team" &&
                            team.filter((t) => !q || t.template.name.toLowerCase().includes(q)).map(({ teamId, template }) => (
                                <button key={template.id} type="button" onClick={() => { close(); void startFromTemplate(teamId, template); }} className="flex flex-col gap-1.5 rounded-xl border border-black/10 p-3 text-left hover:border-[#9747FF]">
                                    <span className="flex h-20 items-center justify-center overflow-hidden rounded-lg bg-[#F5F5F5]">{template.thumb && <img src={template.thumb} alt="" className="h-full w-full object-cover" />}</span>
                                    <span className="text-[13px] font-semibold">{template.name}</span>
                                    <span className="text-[11px] text-black/45">Team template · opens as a new board</span>
                                </button>
                            ))}
                        {!list.length && !saved.length && !(category === "Team" && team.length) && (
                            <p className="col-span-3 py-10 text-center text-[12px] text-black/50">{category === "Yours" ? "Select objects on the board and save them as a template." : category === "Team" ? (teams.length ? "Your teams have no board templates yet." : "Join a team to share templates.") : `No templates match "${query}".`}</p>
                        )}
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

const SHORTCUTS: [string, string][] = [
    ["Move", "V"],
    ["Hand", "H, or hold Space"],
    ["Sticky note", "S"],
    ["Add a sticky or shape beside the selected one", "⌘ Enter"],
    ["Add a sibling (mind maps)", "⌘ ⇧ Enter"],
    ["Rectangle", "R"],
    ["Ellipse", "O"],
    ["Elbowed connector", "X or ⇧ L"],
    ["Straight connector", "L"],
    ["Marker", "M"],
    ["Highlighter", "⇧ M"],
    ["Washi tape", "W"],
    ["Eraser", "⇧ Delete"],
    ["Text", "T"],
    ["Section", "⇧ S"],
    ["Table", "⇧ T"],
    ["Stamp wheel", "E"],
    ["React", "⇧ click a stamp"],
    ["Code block", "`"],
    ["Comment", "C"],
    ["Cursor chat", "/"],
    ["Quick actions", "⌘ / or ⌘ K"],
    ["Edit text of selection", "Enter"],
    ["Bold", "⌘ B"],
    ["Strikethrough", "⌘ ⇧ X"],
    ["Bulleted list", "⌘ ⇧ 8"],
    ["Numbered list", "⌘ ⇧ 7"],
    ["Link", "⌘ ⇧ U"],
    ["Duplicate", "⌘ D, or ⌥ drag"],
    ["Group / ungroup", "⌘ G / ⌘ ⇧ G"],
    ["Create section from selection", "⌘ S"],
    ["Ungroup, or delete a section and keep its contents", "⌘ ⌫"],
    ["Lock / unlock", "⌘ ⇧ L"],
    ["Zoom in / out", "⌘ + / ⌘ −"],
    ["Zoom to fit", "⇧ 1"],
    ["Zoom to selection", "⇧ 2"],
    ["Zoom to 100%", "⌘ 0"],
    ["Upload image or video", "⌘ ⇧ K"],
    ["Export", "⌘ ⇧ E"],
    ["Leave a tool", "Esc"],
];

function HelpPanel({ onClose }: { onClose: () => void }) {
    return (
        <div className="pointer-events-auto absolute bottom-16 right-3 z-20 w-72 rounded-xl bg-white p-3 text-[#1E1E1E] shadow-[0_2px_14px_rgba(0,0,0,0.16)]" aria-label="Keyboard shortcuts">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold">Keyboard shortcuts</span>
                <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-black/5"><X className="size-4" /></button>
            </div>
            <dl className="max-h-80 space-y-1 overflow-y-auto text-[12px]">
                {SHORTCUTS.map(([label, key]) => (
                    <div key={label} className="flex justify-between gap-2">
                        <dt className="text-black/70">{label}</dt>
                        <dd className="font-medium">{key}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

const TOOL_KEYS: Record<string, BoardTool | Tool> = { s: "sticky", r: "shape", o: "shape", x: "connector", l: "connector", m: "marker", w: "washi" };

// Board shortcuts, taken before the design editor's own (which give some of these keys other tools).
function useBoardShortcuts() {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
            const s = editor.get();
            if (!s.doc.board || s.homeOpen || s.editingTextId || s.presentingId) return;
            const b = board.get();
            const key = event.key.toLowerCase();
            const mod = event.metaKey || event.ctrlKey;
            const take = () => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            if (mod && event.shiftKey && !event.altKey && key === "e") {
                take();
                board.set({ exportOpen: true });
                return;
            }
            if (mod && event.shiftKey && !event.altKey && key === "k" && !s.readOnly) {
                take();
                pickImages(viewCenter);
                return;
            }
            // ⌘K opens the board's Actions panel over the toolbar (its "All actions…" row, and ⌘/, open
            // the full command palette).
            if (mod && !event.shiftKey && !event.altKey && key === "k" && !s.readOnly) {
                take();
                board.set({ tray: b.tray === "actions" ? null : "actions", tool: null });
                return;
            }
            if (mod && !event.shiftKey && !event.altKey && (key === "/" || event.code === "Slash")) {
                take();
                editor.set({ actionsOpen: true });
                return;
            }
            // ⌘⌫ on a section or group removes it and keeps what's in it.
            if (mod && (key === "backspace" || key === "delete") && !s.readOnly && s.selection.length && s.selection.every((id) => s.doc.nodes[id]?.isSection || s.doc.nodes[id]?.type === "group")) {
                take();
                ungroupSelection();
                return;
            }
            // ⌘B, ⌘⇧X, ⌘⇧8, ⌘⇧7 on selected stickies, shapes, connectors and text (and on picked
            // table cells, their bold and strikethrough).
            const format = formatForKey(event);
            const picked = b.tableSel ? pickedRange(b.tableSel.id) : null;
            // ⌘⇧U: a link on picked cells, or on the selected stickies, shapes, connectors and text.
            if (linkForKey(event) && !s.readOnly) {
                const tableSel = b.tableSel;
                if (picked && tableSel) {
                    take();
                    const jam = s.doc.nodes[tableSel.id]?.jam;
                    const current = jam?.kind === "table" ? jam.styles?.[picked.top]?.[picked.left]?.link : undefined;
                    void askText("Link", current ?? "https://").then((url) => url !== null && styleCells(tableSel.id, picked, { link: url.trim() && url.trim() !== "https://" ? url.trim() : undefined }));
                    return;
                }
                if (s.selection.length && s.selection.every((id) => { const n = s.doc.nodes[id]; return n?.jam?.kind === "sticky" || n?.jam?.kind === "shape" || n?.jam?.kind === "connector" || n?.type === "text"; })) {
                    take();
                    void askLink(s.selection);
                    return;
                }
            }
            if (format && picked && b.tableSel && !s.readOnly && (format === "bold" || format === "strike")) {
                take();
                const jam = s.doc.nodes[b.tableSel.id]?.jam;
                const style = jam?.kind === "table" ? jam.styles?.[picked.top]?.[picked.left] : undefined;
                if (format === "bold") styleCells(b.tableSel.id, picked, { bold: !(style?.bold ?? picked.top === 0) });
                else styleCells(b.tableSel.id, picked, { strike: !style?.strike || undefined });
                return;
            }
            if (format && !s.readOnly && s.selection.length && s.selection.every((id) => { const n = s.doc.nodes[id]; return n?.jam?.kind === "sticky" || n?.jam?.kind === "shape" || n?.jam?.kind === "connector" || n?.type === "text"; })) {
                take();
                formatText(s.selection, format);
                return;
            }
            // Picked table cells take the arrows, Tab, Return, Delete and typing.
            if (!s.readOnly && !mod && b.tableSel && tableKey(event)) {
                take();
                return;
            }
            if (key === "escape" && (b.tool || b.tray || b.shapesPanel || b.wheel || b.pagesPanel)) {
                take();
                board.set({ tool: null, tray: null, wheel: null, pagesPanel: false });
                return;
            }
            const single = s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined;
            const typeable = single?.jam?.kind === "sticky" || single?.jam?.kind === "shape" || single?.jam?.kind === "connector";
            if (key === "enter" && single && (typeable || single.jam?.kind === "code") && !s.readOnly) {
                take();
                if (mod && event.shiftKey) addSibling(single.id);
                else if (mod && (single.jam?.kind === "sticky" || single.jam?.kind === "shape" || single.jam?.kind === "code")) addAdjacent(single.id, "right");
                else startEditing(single.id);
                return;
            }
            if (s.readOnly || event.altKey || mod) return;
            if ((key === "backspace" || key === "delete") && event.shiftKey) {
                take();
                setBoardTool("eraser", "draw");
                return;
            }
            // Typing on a selected sticky or shape starts its text with that letter.
            if (single && typeable && event.key.length === 1 && !keys.space && single.jam?.kind !== "connector" && /[^\s]/.test(event.key) && !TOOL_KEYS[key] && !"vhtcpbe".includes(key)) {
                take();
                editor.execute({ type: "node.update", id: single.id, patch: { text: (single.text ?? "") + event.key } });
                startEditing(single.id, undefined, true);
                return;
            }
            if (event.key === "`" && !event.shiftKey) return take(), setBoardTool("code");
            if (event.shiftKey) {
                if (key === "s") return take(), setBoardTool(null), editor.set({ tool: "section" });
                if (key === "t") return take(), setBoardTool("table");
                if (key === "i") return take(), board.set({ tray: b.tray === "more" ? null : "more", tool: null });
                if (key === "m") return take(), setBoardTool("highlighter", "draw");
                if (key === "l") return take(), board.set({ connectorLine: "elbow" }), setBoardTool("connector", "shape");
                return;
            }
            if (key === "v" || key === "h" || key === "t" || key === "c") {
                take();
                setBoardTool(null);
                editor.set({ tool: key === "v" ? "move" : key === "h" ? "hand" : key === "t" ? "text" : "comment" });
                return;
            }
            // E opens the stamp wheel at the pointer.
            if (key === "e") {
                take();
                if (b.wheel) board.set({ wheel: null });
                else openWheel(true);
                return;
            }
            const tool = TOOL_KEYS[key];
            if (!tool) return;
            take();
            if (key === "r") board.set({ shape: "square" });
            if (key === "o") board.set({ shape: "ellipse" });
            if (key === "x") board.set({ connectorLine: "elbow" });
            if (key === "l") board.set({ connectorLine: "straight" });
            const tray = tool === "sticky" ? "sticky" : tool === "shape" || tool === "connector" ? "shape" : tool === "marker" || tool === "washi" ? "draw" : tool === "stamp" ? "stamp" : null;
            setBoardTool(tool as BoardTool, tray);
        };
        // Pasting cells copied from a spreadsheet makes a table.
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const s = editor.get();
            if (!s.doc.board || s.readOnly || s.editingTextId || board.get().editing) return;
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (hasCopiedLayers(html)) return;
            const text = event.clipboardData?.getData("text/plain") ?? "";
            // Pictures (and links to them) paste as images, like on every canvas.
            if (clipboardFiles(event.clipboardData).length || htmlImageSources(html).length || isImageUrl(text)) return;
            const rows = parseTable(text);
            // A pasted web address becomes a link preview.
            const url = rows ? null : linkFrom(text);
            if (!rows && !url) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (rows) placeTable(viewCenter(), rows);
            else if (url) placeLink(viewCenter(), url);
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("paste", onPaste, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("paste", onPaste, true);
        };
    }, []);
}

function onToolDragOver(event: React.DragEvent) {
    if (event.dataTransfer.types.includes(TOOL_DRAG)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }
}

function onToolDrop(event: React.DragEvent) {
    const tool = event.dataTransfer.getData(TOOL_DRAG);
    const canvas = (event.currentTarget as HTMLElement).querySelector("canvas")?.getBoundingClientRect();
    if (!tool || !canvas || editor.get().readOnly) return;
    event.preventDefault();
    const world = screenToWorld(editor.get().camera, event.clientX - canvas.left, event.clientY - canvas.top);
    setBoardTool(null);
    if (tool === "sticky") placeSticky(world);
    else startEditing(placeShape({ x: world.x - SHAPE_SIZE / 2, y: world.y - SHAPE_SIZE / 2, w: SHAPE_SIZE, h: SHAPE_SIZE }));
}

// The page button at the end of the file pill: the pages icon, with the page's name beside it once
// the board has more than one page.
function PagesButton({ open, onLeft }: { open: boolean; onLeft: (left: number) => void }) {
    const roots = useEditor((s) => s.doc.roots);
    const nodes = useEditor((s) => s.doc.nodes);
    const page = useEditor((s) => s.doc.nodes[s.pageId]);
    const count = roots.filter((id) => nodes[id] && !nodes[id]?.internal).length;
    const index = roots.indexOf(page?.id ?? "") + 1;
    return (
        <button
            type="button"
            aria-label="Pages"
            aria-pressed={open}
            title="Pages"
            onClick={(e) => {
                const main = (e.currentTarget.closest("[data-board]") as HTMLElement | null)?.getBoundingClientRect();
                onLeft(e.currentTarget.getBoundingClientRect().left - (main?.left ?? 0));
                board.set({ pagesPanel: !open });
            }}
            className={`mx-2 flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[5px] px-1.5 text-[13px] outline-none ${open ? "bg-[#EFE6FD] text-[#7C3AED]" : "hover:bg-black/5"}`}
        >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2.1" y="4.1" width="11.8" height="11.8" rx="1.5" /><path d="M5 2.1 H14.4 Q15.9 2.1 15.9 3.6 V13" />{count > 1 && <text x="8" y="12.6" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">{index}</text>}</svg>
            {count > 1 && <span className="max-w-28 truncate">{page?.name}</span>}
        </button>
    );
}

export function BoardEditor() {
    useBoardShortcuts();
    // The shared Export command (⇧⌘E, the actions palette) opens the board's own export.
    const exportAsked = useVectorUi((s) => s.exportOpen);
    useEffect(() => {
        if (!exportAsked) return;
        vectorUi.set({ exportOpen: false });
        board.set({ exportOpen: true });
    }, [exportAsked]);
    const toast = useEditor((s) => s.toast);
    const uiHidden = useEditor((s) => s.uiHidden);
    const pagesOpen = useBoard((s) => s.pagesPanel);
    const help = useBoard((s) => s.helpOpen);
    const setHelpState = (helpOpen: boolean) => board.set({ helpOpen });
    const [pagesLeft, setPagesLeft] = useState(150);
    // Leaving the board puts the design tools back the way they were.
    useEffect(() => () => board.set({ tool: null, tray: null, editing: null }), []);
    return (
        <div className="relative flex min-h-0 w-full flex-1">
            <main className="relative min-w-0 flex-1" data-board onDragOver={onToolDragOver} onDrop={onToolDrop}>
                <ErrorBoundary name="canvas">
                    <CanvasView />
                </ErrorBoundary>
                <BoardEmbeds />
                <BoardTextEditor />
                <SectionTitleEditor />
                <TextLayerMentions />
                {!uiHidden && (
                    <div className="pointer-events-none absolute inset-0">
                        <div className="absolute left-3 top-3 flex gap-2">
                            <div className={`${pill} pl-2`}>
                                <AriaMenuTrigger>
                                    <AriaButton aria-label="Main menu" className={`${pillButton} pr-1`}>
                                        <NagmaLogo size={16} />
                                        <ChevronDown className="size-3 text-black/60" />
                                    </AriaButton>
                                    <AriaPopover placement="bottom start" offset={6} className={MENU_CLASS}>
                                        <MenuLevel nodes={BOARD_MENU} label="Main menu" />
                                    </AriaPopover>
                                </AriaMenuTrigger>
                                <FileName />
                                <span className="h-12 w-px bg-black/[0.08]" />
                                <PagesButton open={pagesOpen} onLeft={setPagesLeft} />
                            </div>
                        </div>
                        <div className="absolute right-3 top-3 flex gap-2">
                            <div className={`${pill} gap-2 px-2`}>
                                <span className="flex w-[46px] items-center">
                                    <PresenceAvatars chevron />
                                </span>
                                <AudioButton />
                                <button type="button" aria-label="Templates" title="Templates" onClick={() => board.set({ templatesOpen: true })} className="ml-1 flex size-8 items-center justify-center rounded-[5px] outline-none hover:bg-black/5">
                                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1.6" y="2.1" width="14.8" height="13.8" rx="1.5" /><path d="M1.6 6.6 H16.4 M6.6 6.6 V15.9" /></svg>
                                </button>
                                <MeetingsButton />
                                <ShareBoard />
                            </div>
                        </div>
                        <div className="absolute right-3 top-16 z-20">
                            <VotingInvite />
                        </div>
                        <PagesPanel left={pagesLeft} />
                        <MeetingsPanel />
                        <ShapesPanel />
                        <ContextBar />
                        <div className="absolute inset-x-0 bottom-3 flex flex-col items-center">
                            <div className="mb-2"><Captions /></div>
                            <Recenter />
                            <div className="mb-2 empty:hidden"><PlaceBar /></div>
                            <BoardToolbar />
                        </div>
                        <div className="absolute bottom-[14px] right-3 flex gap-2">
                            <BoardZoom />
                            <button type="button" aria-label="Help and shortcuts" aria-pressed={help} onClick={() => setHelpState(!help)} className="pointer-events-auto flex size-8 items-center justify-center rounded-full bg-white text-[16px] text-[#1E1E1E] shadow-[0_0_0.5px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.1),0_3px_8px_rgba(0,0,0,0.08)] outline-none hover:bg-[#F5F5F5]">?</button>
                        </div>
                        {help && <HelpPanel onClose={() => setHelpState(false)} />}
                    </div>
                )}
                {toast && (
                    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
                        <div className="rounded-lg bg-tooltip px-3 py-2 text-[12px] text-white shadow-lg">{toast}</div>
                    </div>
                )}
            </main>
            <BoardSidePanel />
            <TemplatesModal />
            <BoardExportDialog />
            <MaximizedEmbed />
            <StampWheel />
            <BoardContextMenu />
            <ActionsPalette />
            <NamePrompt />
            <SaveVersionDialog />
        </div>
    );
}

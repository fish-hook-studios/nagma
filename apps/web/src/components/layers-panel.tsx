import { ChevronDown, ChevronUpDouble, Eye, EyeOff, Lock01, LockUnlocked01, SearchSm } from "@untitledui/icons";
import { createElement, memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { DenseMenu, MenuRow } from "./left-sidebar";
import { openLibraries, openPublish } from "./library-ui";
import { runAction } from "../engine/menu-actions";
import { layerRoots } from "../engine/page";
import { PagesList } from "./pages-list";
import { DevStatusList } from "./dev-sections";
import { FindPanel } from "./find-panel";
import { closeFind, collapseLayers, openFind, setCollapsed as storeCollapsed, ui, useUi } from "../engine/ui-state";
import { type DropPosition, type DropTarget, beginLayerDrag, beginToggleDrag, layerDragState } from "./layer-drag";
import { getServerFiles, getStarredFiles, openHome, refreshServerFiles, renameFile, starKey, subscribeServerFiles, subscribeStarredFiles, toggleStarFile } from "../engine/files";
import { duplicateCurrentFile, moveCurrentFile, trashCurrentFile } from "../engine/file-actions";
import { collab, useCollab } from "../engine/collab";
import { useAuth } from "../engine/auth";
import { getTeams, projectOf, refreshTeams, useTeams } from "../engine/teams";
import { listLocalFolders } from "../engine/folders";
import { download } from "../engine/export";
import { fileMeta } from "../engine/files";
import { vectorUi } from "../engine/vector-ui";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { isReusable, layerIcon } from "./layer-kind";
import { ModeTag } from "./variable-picker";
import { renderThumb } from "../engine/thumb";
import { fitRect } from "../engine/camera";
import { selectionBounds } from "../engine/nodes";


// Options a product can give the tree (Sites): a row for the page itself with its layers nested under
// it, labels that group a layer's children (FIXED / SCROLLS) and a tag after a layer's name.
export interface LayersTreeOptions {
    pageRow?: { label: string; icon: React.ReactNode; selected: boolean; onSelect: () => void };
    groupOf?: (node: SceneNode, parent: SceneNode) => string | null;
    // The groups' order (by label); others follow in the order they first appear.
    groupOrder?: string[];
    badge?: (node: SceneNode) => string | null;
    // The order of the page's top-level rows (front-most first otherwise).
    topOrder?: (nodes: SceneNode[]) => SceneNode[];
}

export function LayersPanel({ tree }: { tree?: LayersTreeOptions } = {}) {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const collapsed = useUi((u) => u.collapsed);
    const setCollapsed = (update: (current: Set<string>) => Set<string>) => storeCollapsed(update(ui.get().collapsed));
    const [drop, setDrop] = useState<DropTarget | null>(null);
    const selection = useEditor((s) => s.selection);
    const listRef = useRef<HTMLDivElement>(null);
    const findOpen = useUi((u) => u.findOpen);
    const mode = useEditor((s) => s.mode);
    // Row state comes from here, not from a store subscription per row: thousands of rows each
    // subscribing made every store change (a hover, a nudge) run thousands of selectors.
    const hoverId = useEditor((s) => s.hoverId);
    const draw = useEditor((s) => s.mode === "draw");
    const renameRequest = useEditor((s) => s.renameRequest);

    // A selection made on the canvas opens its parents and scrolls into view, as design tools do.
    useEffect(() => {
        const first = selection[0];
        if (!first) return;
        const ancestors: string[] = [];
        let cursor = doc.nodes[first]?.parentId ?? null;
        while (cursor && doc.nodes[cursor]?.type !== "page") {
            ancestors.push(cursor);
            cursor = doc.nodes[cursor]?.parentId ?? null;
        }
        if (ancestors.some((id) => collapsed.has(id))) {
            setCollapsed((current) => {
                const next = new Set(current);
                for (const id of ancestors) next.delete(id);
                return next;
            });
        }
        requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-layer="${first}"]`)?.scrollIntoView({ block: "nearest" }));
        // Only the selection should trigger this, not every document edit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection]);

    // Stable handlers, so a row only re-renders when its own layer, state or drop marker changes
    // (with thousands of layers, re-rendering every row on each selection change or nudge was slow).
    const toggle = useCallback((id: string) => {
        const next = new Set(ui.get().collapsed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        storeCollapsed(next);
    }, []);
    const rowPointerDown = useCallback((event: React.PointerEvent, id: string) => beginLayerDrag(event, id, listRef.current, setDrop), []);

    // Front-most layers are listed first, like every design tool.
    const rows: { node: SceneNode; depth: number }[] = [];
    const labels = new Map<number, { label: string; depth: number }>();
    const visit = (ids: string[], depth: number, parent?: SceneNode) => {
        const nodes: SceneNode[] = [];
        for (let i = ids.length - 1; i >= 0; i--) {
            const node = doc.nodes[ids[i] ?? ""];
            if (node) nodes.push(node);
        }
        if (!parent && tree?.topOrder) nodes.splice(0, nodes.length, ...tree.topOrder(nodes));
        // Grouped children: each group under its label, the groups in the order they first appear.
        const groups = new Map<string | null, SceneNode[]>();
        for (const node of nodes) {
            const label = tree?.groupOf && parent ? tree.groupOf(node, parent) : null;
            groups.set(label, [...(groups.get(label) ?? []), node]);
        }
        const rank = (label: string | null) => {
            const i = label ? (tree?.groupOrder?.indexOf(label) ?? -1) : -1;
            return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        for (const [label, members] of [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))) {
            if (label) labels.set(rows.length, { label, depth });
            for (const node of members) {
                rows.push({ node, depth });
                if (!collapsed.has(node.id)) visit(node.children, depth + 1, node);
            }
        }
    };
    const pageKey = `page:${pageId}`;
    const pageOpen = !collapsed.has(pageKey);
    if (!tree?.pageRow || pageOpen) visit(doc.nodes[pageId]?.children ?? [], tree?.pageRow ? 1 : 0);
    const selected = new Set(selection);
    // The row Tab lands on in the tree: the first selected row shown, else the top one.
    const tabStop = rows.find((r) => selection.includes(r.node.id))?.node.id ?? rows[0]?.node.id;

    return (
        <>
            <PagesList />
            {mode === "dev" && <DevStatusList />}
            <section className="flex min-h-0 flex-1 flex-col border-t border-panel-border pt-1">
                <div className="flex h-8 shrink-0 items-center justify-between pr-2 pl-4">
                    <span className="font-semibold">{findOpen ? "Find" : "Layers"}</span>
                    <div className="flex items-center">
                        <AriaButton aria-label="Find layers" onPress={() => (findOpen ? closeFind() : openFind())} className={`flex size-6 items-center justify-center rounded outline-none hover:bg-panel-hover hover:text-ink ${findOpen ? "text-ink" : "text-ink-muted"}`}>
                            <SearchSm className="size-3.5" />
                        </AriaButton>
                        <AriaButton aria-label="Collapse all layers" onPress={collapseLayers} className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <ChevronUpDouble className="size-3.5" />
                        </AriaButton>
                    </div>
                </div>
                {findOpen ? <FindPanel /> : <div ref={listRef} role="tree" aria-label="Layers" aria-multiselectable="true" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onPointerLeave={() => editor.set({ hoverId: null })}>
                    {tree?.pageRow && (
                        <div
                            role="treeitem"
                            aria-level={1}
                            aria-selected={tree.pageRow.selected}
                            aria-expanded={pageOpen}
                            aria-label={tree.pageRow.label}
                            onClick={tree.pageRow.onSelect}
                            className={`flex h-8 cursor-default items-center gap-1 rounded-md pr-1 pl-2 text-ink ${tree.pageRow.selected ? "bg-brand-100" : "hover:bg-panel-hover"}`}
                        >
                            <span className="flex size-4 shrink-0 items-center justify-center">
                                <button
                                    type="button"
                                    aria-label={pageOpen ? "Collapse" : "Expand"}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        toggle(pageKey);
                                    }}
                                    className="text-ink-subtle hover:text-ink"
                                >
                                    <ChevronDown className={`size-3 transition-transform ${pageOpen ? "" : "-rotate-90"}`} />
                                </button>
                            </span>
                            {tree.pageRow.icon}
                            <span className="min-w-0 flex-1 truncate">{tree.pageRow.label}</span>
                        </div>
                    )}
                    {rows.map(({ node, depth }, index) => [
                        labels.has(index) && (
                            <div key={`label:${node.id}`} className="flex h-6 items-end pb-1 text-[9px] font-medium tracking-wide text-ink-subtle uppercase" style={{ paddingLeft: 8 + (labels.get(index)?.depth ?? 0) * 16 + 20 }}>
                                {labels.get(index)?.label}
                            </div>
                        ),
                        <LayerRow
                            key={node.id}
                            badge={tree?.badge?.(node) ?? null}
                            node={node}
                            depth={depth}
                            expanded={!collapsed.has(node.id)}
                            onToggle={toggle}
                            drop={drop?.id === node.id ? drop.position : null}
                            onPointerDown={rowPointerDown}
                            tabStop={node.id === tabStop}
                            selected={selected.has(node.id)}
                            hovered={hoverId === node.id}
                            draw={draw}
                            renameRequested={renameRequest === node.id}
                        />,
                    ])}
                    {rows.length === 0 && <p className="px-2 py-3 leading-relaxed text-ink-muted">No layers yet. Press F to draw a frame or R for a rectangle.</p>}
                </div>}
            </section>
        </>
    );
}

// The file-name menu: 24pt rows on #1E1E1E, 8pt rules.
const FILE_MENU = "rounded-[13px] bg-tooltip p-2 text-white shadow-xl outline-none";
const FILE_RULE = "-mx-2 my-2 h-px bg-white/10";

export function FileHeader({ actions, onExport, lead }: { actions?: React.ReactNode; onExport?: () => void; lead?: React.ReactNode }) {
    const name = useEditor((s) => s.doc.name);
    const fileId = useEditor((s) => s.fileId);
    const meta = fileMeta(fileId);
    const account = useAuth((s) => s.user);
    const signedIn = Boolean(account);
    // A server file someone else owns is "Shared with you"; your own, outside a project, is in Drafts.
    const owner = useSyncExternalStore(subscribeServerFiles, () => (meta?.shared ? getServerFiles().find((f) => f.id === meta.shared)?.owner?.id : undefined));
    // A shared file's folder is the server's record (moves made elsewhere included).
    const serverProject = useSyncExternalStore(subscribeServerFiles, () => (meta?.shared ? getServerFiles().find((f) => f.id === meta.shared)?.project : undefined));
    const project = meta?.shared && serverProject !== undefined ? serverProject : meta?.project;
    // Opened straight from a link or at start: fetch where the file lives.
    const shared = meta?.shared;
    useEffect(() => {
        if (!shared) return;
        void refreshServerFiles();
        if (!getTeams().length) void refreshTeams();
    }, [shared]);
    const draftFolder = meta?.folderId ? listLocalFolders().find((f) => f.id === meta.folderId && !f.trashed) : undefined;
    const where = project ? (projectOf(project)?.project.name ?? "Folder") : meta?.shared && owner && owner !== account?.id ? "Shared with you" : (draftFolder?.name ?? "Drafts");
    const [editing, setEditing] = useState(false);
    const teams = useTeams();
    // Team folders you can add files to, named by their path.
    const projects = teams.flatMap((t) => {
        const byId = new Map(t.projects.map((p) => [p.id, p]));
        const path = (p: (typeof t.projects)[number]): string[] => {
            const names: string[] = [];
            const seen = new Set<string>();
            for (let x: (typeof t.projects)[number] | undefined = p; x && !seen.has(x.id); x = x.parentId ? byId.get(x.parentId) : undefined) {
                seen.add(x.id);
                names.unshift(x.name);
            }
            return names;
        };
        return t.projects.filter((p) => !p.trashed && (p.role === undefined ? t.role !== "view" : p.role === "admin" || p.role === "edit")).map((p) => ({ ...p, team: t.name, label: path(p).join(" / ") }));
    });
    const colorProfile = useEditor((s) => s.doc.colorProfile ?? "srgb");
    const starred = useSyncExternalStore(subscribeStarredFiles, () => (meta ? getStarredFiles().includes(starKey(meta)) : false));
    const collabRole = useCollab((s) => s.role);
    const collabStatus = useCollab((s) => s.status);
    const canEdit = collabStatus === "local" || collabRole === "edit";
    const run = (key: string) => {
        if (!fileId) return;
        if (key === "rename") setEditing(true);
        else if (key === "duplicate") void duplicateCurrentFile();
        else if (key === "history") collab.set({ historyOpen: true });
        else if (key.startsWith("move:")) void moveCurrentFile(key.slice(5) || null);
        else if (key === "where") openHome();
        else if (key === "export") (onExport ?? (() => vectorUi.set({ exportOpen: true })))();
        else if (key === "save") download(new Blob([JSON.stringify(editor.get().doc)], { type: "application/json" }), `${name || "Untitled"}.nagma.json`);
        // The trash keeps it, so no confirmation: it can be restored from Trash on Home.
        else if (key === "trash") trashCurrentFile();
        else if (key === "home") openHome();
        else if (key === "libraries") openLibraries();
        else if (key === "publish") openPublish();
        else if (key === "toSlides") {
            // The page's top-level frames shaped like slides, in reading order.
            editor.set({ selection: layerRoots(editor.get().doc) });
            void import("../slides/from-design").then((m) => m.copyFramesToSlides());
        } else if (key === "star" && meta) toggleStarFile(starKey(meta));
        else if (key === "branch") runAction("branch");
        else if (key === "srgb" || key === "p3") editor.execute({ type: "doc.settings", patch: { colorProfile: key } });
    };

    return (
        // 64 with the rule under it, as in the reference: the name 24.5 from the top, the folder 24 below it.
        <header className="flex h-16 shrink-0 items-start gap-1 border-b border-panel-border px-3 pt-[13px]">
            {lead}
            <div className="min-w-0 flex-1">
                {editing ? (
                    <input
                        autoFocus
                        defaultValue={name}
                        aria-label="File name"
                        className="w-full rounded border border-brand-500 bg-field px-1 py-0.5 text-[13px] font-semibold outline-none"
                        onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value && value !== name) {
                                editor.execute({ type: "doc.rename", name: value });
                                if (fileId) renameFile(fileId, value);
                            }
                            setEditing(false);
                        }}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") setEditing(false);
                        }}
                    />
                ) : (
                    <AriaMenuTrigger>
                        <AriaButton className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[13px] font-semibold outline-none hover:bg-panel-hover">
                            <span className="truncate">{name}</span>
                            <ChevronDown className="size-3 shrink-0 text-ink-muted mr-1" />
                        </AriaButton>
                        <AriaPopover placement="bottom start" offset={4} className={`w-[223px] ${FILE_MENU}`}>
                            <DenseMenu>
                                <AriaMenu aria-label="File" className="outline-none" onAction={(k) => run(String(k))}>
                                    <MenuRow id="history" label="Show version history" />
                                    <AriaSubmenuTrigger>
                                        <MenuRow id="library" label="Library" shortcut="›" />
                                        <AriaPopover offset={4} crossOffset={-8} className={`w-max min-w-[160px] ${FILE_MENU}`}>
                                            <AriaMenu className="outline-none" aria-label="Library" onAction={(k) => run(String(k))}>
                                                <MenuRow id="publish" label="Publish library…" />
                                                <MenuRow id="libraries" label="Manage libraries…" />
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaSubmenuTrigger>
                                    <MenuRow id="export" label="Export…" shortcut="⇧ ⌘ E" />
                                    <AriaSeparator className={FILE_RULE} />
                                    <MenuRow id="toSlides" label="Copy current page to Slides…" />
                                    <AriaSubmenuTrigger>
                                        <MenuRow id="sidebar" label="Add to sidebar" shortcut="›" />
                                        <AriaPopover offset={4} crossOffset={-8} className={`w-max min-w-[160px] ${FILE_MENU}`}>
                                            <AriaMenu className="outline-none" aria-label="Add to sidebar" onAction={(k) => run(String(k))}>
                                                <MenuRow id="star" label="Starred" checked={starred} />
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaSubmenuTrigger>
                                    {canEdit && <MenuRow id="branch" label="Create branch…" />}
                                    <AriaSubmenuTrigger>
                                        <MenuRow id="profile" label="File color profile" shortcut="›" />
                                        <AriaPopover offset={4} crossOffset={-8} className={`w-max min-w-[160px] ${FILE_MENU}`}>
                                            <AriaMenu className="outline-none" aria-label="File color profile" disabledKeys={canEdit ? [] : ["srgb", "p3"]} onAction={(k) => run(String(k))}>
                                                <MenuRow id="srgb" label="sRGB" checked={colorProfile === "srgb"} />
                                                <MenuRow id="p3" label="Display P3" checked={colorProfile === "p3"} />
                                            </AriaMenu>
                                        </AriaPopover>
                                    </AriaSubmenuTrigger>
                                    <AriaSeparator className={FILE_RULE} />
                                    <MenuRow id="duplicate" label="Duplicate" />
                                    {canEdit && <MenuRow id="rename" label="Rename" />}
                                    <MenuRow id="where" label="Go to folder" />
                                    {signedIn && canEdit && (
                                        <AriaSubmenuTrigger>
                                            <MenuRow id="move" label="Move file…" shortcut="›" />
                                            <AriaPopover offset={4} crossOffset={-8} className={`max-h-80 w-60 overflow-y-auto ${FILE_MENU}`}>
                                                <AriaMenu className="outline-none" aria-label="Move file" onAction={(k) => run(String(k))}>
                                                    {projects.map((p) => (
                                                        <MenuRow key={p.id} id={`move:${p.id}`} label={`${p.team} / ${p.label}`} checked={project === p.id} />
                                                    ))}
                                                    {projects.length === 0 && <MenuRow id="where" label="No folders yet: make one on Home" />}
                                                    {project && <MenuRow id="move:" label="Drafts" checked={false} />}
                                                </AriaMenu>
                                            </AriaPopover>
                                        </AriaSubmenuTrigger>
                                    )}
                                    <AriaSeparator className={FILE_RULE} />
                                    <MenuRow id="trash" label={canEdit ? "Move to trash" : "Remove from recents"} />
                                </AriaMenu>
                            </DenseMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                )}
                <button type="button" onClick={openHome} className="mt-1 block max-w-full truncate rounded px-1 text-left text-ink-muted hover:text-ink">
                    {where}
                </button>
            </div>
            {actions}
        </header>
    );
}

interface LayerRowProps {
    node: SceneNode;
    depth: number;
    expanded: boolean;
    onToggle: (id: string) => void;
    drop: DropPosition | null;
    onPointerDown: (event: React.PointerEvent, id: string) => void;
    // The row that takes keyboard focus when tabbing into the tree.
    tabStop?: boolean;
    selected: boolean;
    hovered: boolean;
    // Draw mode shows each layer as a picture instead of an icon.
    draw: boolean;
    // ⌘R asks for this row's name to open; the request clears when editing ends.
    renameRequested: boolean;
    // A tag after the name ("Primary").
    badge?: string | null;
}

// Keyboard in the Layers tree (reached with Tab or F6): ↑ ↓ move between rows and select (⇧ adds),
// → opens a layer or goes to its first child, ← closes it or goes to its parent, Home and End jump,
// Space adds or removes a row from the selection, Return or F2 renames.
function treeKey(event: React.KeyboardEvent<HTMLDivElement>, node: SceneNode, expanded: boolean, onToggle: () => void, rename: () => void) {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const rowsEls = [...(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>("[data-layer-id]") ?? [])];
    const index = rowsEls.indexOf(event.currentTarget);
    const go = (el: HTMLElement | undefined, extend = false) => {
        const id = el?.dataset.layerId;
        if (!el || !id) return;
        const { selection } = editor.get();
        editor.set({ selection: extend ? Array.from(new Set([...selection, id])) : [id] });
        el.focus();
    };
    const handled = () => {
        event.preventDefault();
        event.stopPropagation();
    };
    const open = node.children.length > 0 && expanded;
    switch (event.key) {
        case "ArrowDown":
            handled();
            return go(rowsEls[index + 1], event.shiftKey);
        case "ArrowUp":
            handled();
            return go(rowsEls[index - 1], event.shiftKey);
        case "Home":
            handled();
            return go(rowsEls[0]);
        case "End":
            handled();
            return go(rowsEls[rowsEls.length - 1]);
        case "ArrowRight":
            handled();
            if (node.children.length && !expanded) return onToggle();
            if (open) return go(rowsEls[index + 1]);
            return;
        case "ArrowLeft": {
            handled();
            if (open) return onToggle();
            const parent = rowsEls.find((el) => el.dataset.layerId === node.parentId);
            return go(parent);
        }
        case " ": {
            handled();
            const { selection } = editor.get();
            return editor.set({ selection: selection.includes(node.id) ? selection.filter((id) => id !== node.id) : [...selection, node.id] });
        }
        case "Enter":
        case "F2":
            handled();
            return rename();
    }
}

// Pictures of layers for Draw mode's layers list, redrawn only when the layer or anything inside
// it changes (layers are replaced, never mutated, so comparing the objects is enough).
const previews = new WeakMap<SceneNode, { parts: SceneNode[]; src: string }>();

function subtreeOf(doc: NagmaDocument, id: string, out: SceneNode[] = []): SceneNode[] {
    const n = doc.nodes[id];
    if (!n || out.length > 400) return out;
    out.push(n);
    for (const c of n.children) subtreeOf(doc, c, out);
    return out;
}

function LayerPreview({ id, top }: { id: string; top: boolean }) {
    const doc = useEditor((s) => s.doc);
    const node = doc.nodes[id];
    if (!node) return null;
    const parts = subtreeOf(doc, id);
    const cached = previews.get(node);
    let src = cached && cached.parts.length === parts.length && cached.parts.every((p, i) => p === parts[i]) ? cached.src : null;
    if (!src) {
        src = renderThumb(doc, 80, 64, id);
        previews.set(node, { parts, src });
    }
    return (
        <img
            src={src}
            alt=""
            onDoubleClick={(event) => {
                // Double-click the picture to zoom to the layer.
                event.stopPropagation();
                const box = selectionBounds(editor.get().doc, [id]);
                if (box) fitRect(box, 80, 8);
            }}
            className={`shrink-0 rounded-[3px] border border-panel-border object-contain ${top ? "h-7 w-8" : "size-6"}`}
        />
    );
}

export const LayerRow = memo(function LayerRow({ node, depth, expanded, onToggle: toggleId, drop, onPointerDown: pointerDownId, tabStop, selected, hovered, draw, renameRequested, badge }: LayerRowProps) {
    const onToggle = () => toggleId(node.id);
    const onPointerDown = (event: React.PointerEvent) => pointerDownId(event, node.id);
    const [renamingLocal, setRenamingLocal] = useState(false);
    const renaming = renamingLocal || renameRequested;
    const setRenaming = (on: boolean) => {
        setRenamingLocal(on);
        if (!on && renameRequested) editor.set({ renameRequest: null });
    };
    const cancelled = useRef(false);

    const select = (event: React.MouseEvent) => {
        if (layerDragState.justDragged) return;
        const { selection } = editor.get();
        if (event.shiftKey && selection.length) {
            // ⇧click selects the range between the last selected row and this one, in panel order.
            const order = [...document.querySelectorAll<HTMLElement>("[data-layer-id]")].map((el) => el.dataset.layerId ?? "");
            const a = order.indexOf(selection[selection.length - 1] ?? "");
            const b = order.indexOf(node.id);
            if (a >= 0 && b >= 0) {
                const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
                editor.set({ selection: Array.from(new Set([...selection, ...range])) });
                return;
            }
        }
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            editor.set({ selection: selection.includes(node.id) ? selection.filter((id) => id !== node.id) : [...selection, node.id] });
        } else {
            editor.set({ selection: [node.id] });
        }
    };

    return (
        <div
            data-layer-id={node.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected}
            aria-expanded={node.children.length ? expanded : undefined}
            aria-label={node.name}
            tabIndex={tabStop ? 0 : -1}
            onKeyDown={renaming ? undefined : (event) => treeKey(event, node, expanded, onToggle, () => setRenaming(true))}
            // A click selects without taking focus, so the arrow keys keep nudging the layer on the canvas.
            onMouseDown={(event) => {
                if (event.target === event.currentTarget || !(event.target as HTMLElement).closest("input")) event.preventDefault();
            }}
            onPointerDown={renaming ? undefined : onPointerDown}
            onClick={select}
            onDoubleClick={() => setRenaming(true)}
            onContextMenu={(event) => {
                event.preventDefault();
                if (!editor.get().selection.includes(node.id)) editor.set({ selection: [node.id] });
                editor.set({ contextMenu: { x: event.clientX, y: event.clientY } });
            }}
            onPointerEnter={() => editor.set({ hoverId: node.id })}
            data-layer={node.id}
            className={`group relative flex ${draw && depth === 0 ? "h-10" : "h-8"} cursor-default items-center gap-1 rounded-md pr-1 ${
                drop === "inside"
                    ? "outline outline-2 -outline-offset-2 outline-brand-500"
                    : selected
                      ? "bg-brand-100 text-ink"
                      : hovered
                        ? "bg-panel-hover"
                        : ""
            } ${node.visible ? (depth === 0 || selected ? "text-ink" : "text-ink-muted") : "text-ink-subtle"}`}
            style={{ paddingLeft: 8 + depth * 16 }}
        >
            {(drop === "above" || drop === "below") && (
                <span
                    className={`pointer-events-none absolute right-0 h-0.5 rounded bg-brand-500 ${drop === "above" ? "-top-px" : "-bottom-px"}`}
                    style={{ left: 8 + depth * 16 }}
                />
            )}
            <span className="flex size-4 shrink-0 items-center justify-center">
                {node.children.length > 0 && (
                    <button
                        type="button"
                        aria-label={expanded ? "Collapse" : "Expand"}
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggle();
                        }}
                        className="text-ink-subtle hover:text-ink"
                    >
                        <ChevronDown className={`size-3 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                    </button>
                )}
            </span>
            {/* Draw mode: 40pt top-level rows and 32pt nested ones, the kind's icon and then a picture. */}
            {createElement(layerIcon(node), { className: `size-3.5 shrink-0 ${isReusable(node) ? "text-[#B67CFF]" : selected ? "text-ink" : "text-ink-subtle"}` })}
            {draw && <LayerPreview id={node.id} top={depth === 0} />}
            {renaming ? (
                <input
                    autoFocus
                    defaultValue={node.name}
                    aria-label="Layer name"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => {
                        cancelled.current = false;
                        event.currentTarget.select();
                    }}
                    className="min-w-0 flex-1 rounded border border-brand-500 bg-field px-1 outline-none"
                    onBlur={(event) => {
                        const value = event.target.value.trim();
                        if (!cancelled.current && value && value !== node.name) editor.execute({ type: "node.update", id: node.id, patch: { name: value } });
                        setRenaming(false);
                    }}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                            cancelled.current = true;
                            event.currentTarget.blur();
                        }
                        // Tab renames the next layer down the list (⇧Tab the one above).
                        if (event.key === "Tab") {
                            event.preventDefault();
                            const order = [...document.querySelectorAll<HTMLElement>("[data-layer-id]")].map((el) => el.dataset.layerId ?? "");
                            const next = order[order.indexOf(node.id) + (event.shiftKey ? -1 : 1)];
                            event.currentTarget.blur();
                            if (next) editor.set({ selection: [next], renameRequest: next });
                        }
                    }}
                />
            ) : (
                <span className="min-w-0 flex-1 truncate">
                    {node.name}
                </span>
            )}
            {badge && <span className="shrink-0 rounded-[4px] bg-brand-500 px-1.5 py-px text-[10px] font-semibold text-white">{badge}</span>}
            {node.variableModes && Object.keys(node.variableModes).length > 0 && <ModeTag node={node} />}
            <span className={`flex items-center gap-0.5 ${node.locked || !node.visible ? "" : "opacity-0 group-hover:opacity-100"}`}>
                <button
                    type="button"
                    aria-label={node.locked ? "Unlock" : "Lock"}
                    data-toggle="locked"
                    onPointerDown={(event) => beginToggleDrag(event, node.id, "locked")}
                    onClick={(event) => {
                        event.stopPropagation();
                        // Pointer presses are handled on pointer down; this is the keyboard path.
                        if (event.detail === 0) editor.execute({ type: "node.update", id: node.id, patch: { locked: !node.locked } });
                    }}
                    className={`flex size-5 items-center justify-center rounded text-ink-muted hover:bg-black/5 ${node.locked ? "" : "opacity-0 group-hover:opacity-100"}`}
                >
                    {node.locked ? <Lock01 className="size-3" /> : <LockUnlocked01 className="size-3" />}
                </button>
                <button
                    type="button"
                    aria-label={node.visible ? "Hide" : "Show"}
                    data-toggle="visible"
                    onPointerDown={(event) => beginToggleDrag(event, node.id, "visible")}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (event.detail === 0) editor.execute({ type: "node.update", id: node.id, patch: { visible: !node.visible } });
                    }}
                    className={`flex size-5 items-center justify-center rounded text-ink-muted hover:bg-black/5 ${node.visible ? "opacity-0 group-hover:opacity-100" : ""}`}
                >
                    {node.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
            </span>
        </div>
    );
});

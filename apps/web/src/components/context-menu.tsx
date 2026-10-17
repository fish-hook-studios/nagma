import { useRef } from "react";
import { Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { createInstance, enterVectorEdit, paste, pasteAt } from "../engine/actions";
import { collab } from "../engine/collab";
import { tidyUp } from "../engine/arrange";
import { restoreDefaultThumbnail, setAsThumbnail, thumbnailFrame } from "../engine/files";
import { layersAtClient, worldAtClient } from "../engine/layers-under";
import { ACTION_BY_ID, actionEnabled, actionLabel } from "../engine/menu-actions";
import { setMode } from "../engine/modes";
import { flattenPdfPage, isEditablePage, makePdfPageEditable, openPdfEditor, pdfPaint } from "../engine/pdf";
import { firstImagePaint, openPhotoEditor } from "../engine/photo";
import { editor, useEditor } from "../engine/store";
import { devStatusMenuItems } from "./dev-status-state";
import { MenuRow } from "./left-sidebar";
import { MoveToPageSubmenu } from "./move-to-page-menu";
import { SelectLayerSubmenu } from "./select-layer-menu";
import { systemsMenuItems } from "../engine/component-actions";
import { canMakeBrush, createBrush } from "../engine/custom-brushes";

// A row: an action from the shared table (by id), or one that only makes sense here.
type Row = string | { id: string; label: string; shortcut?: string; run: () => void } | "separator";

const MENU_CLASS = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

// Context menus word a few shared actions more briefly.
const SHORT_LABELS: Record<string, string> = {
    visible: "Show/Hide",
    lock: "Lock/Unlock",
    ungroup: "Ungroup",
};

// "Copy/Paste as ▸": the clipboard formats and property copy, grouped the way the reference's menu does.
const COPY_PASTE_AS = ["copyText", "copyCss", "copySwift", "copyCompose", "copySvg", "copyPng", "copyLink", "-", "copyProps", "pasteProps"];

function CopyPasteAsSubmenu() {
    const state = useEditor((s) => s);
    const hasText = state.selection.some(function walk(id: string): boolean {
        const node = state.doc.nodes[id];
        return Boolean(node && (node.type === "text" || node.children.some(walk)));
    });
    const ids = COPY_PASTE_AS.filter((id) => id !== "copyText" || hasText);
    const disabled = ids.filter((id) => {
        const action = ACTION_BY_ID.get(id);
        return action && !actionEnabled(action, state);
    });
    return (
        <AriaSubmenuTrigger>
            <MenuRow id="copyPasteAs" label="Copy/Paste as" shortcut="›" />
            <AriaPopover offset={-4} className={MENU_CLASS}>
                <AriaMenu
                    aria-label="Copy/Paste as"
                    className="outline-none"
                    disabledKeys={disabled}
                    onAction={(key) => {
                        editor.set({ contextMenu: null });
                        ACTION_BY_ID.get(String(key))?.run();
                    }}
                >
                    {ids.map((id, i) => {
                        if (id === "-") return <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" />;
                        const action = ACTION_BY_ID.get(id);
                        return action ? <MenuRow key={id} id={id} label={action.label} shortcut={action.shortcut} /> : null;
                    })}
                </AriaMenu>
            </AriaPopover>
        </AriaSubmenuTrigger>
    );
}

// The right-click menu for the canvas and the layers list, acting on the current selection.
export function ContextMenu() {
    const position = useEditor((s) => s.contextMenu);
    return position ? <ContextMenuBody position={position} /> : null;
}

function ContextMenuBody({ position }: { position: { x: number; y: number } }) {
    const state = useEditor((s) => s);
    const anchor = useRef<HTMLDivElement>(null);

    const { doc, selection } = state;
    const nodes = selection.map((id) => doc.nodes[id]).filter((n) => n !== undefined);
    const hasGroup = nodes.some((node) => node.type === "group");
    const hasLayout = nodes.some((node) => node.layout);
    const single = nodes.length === 1 ? nodes[0] : undefined;
    // Right-clicks on the canvas list the layers under the cursor; the Layers panel has none.
    const under = layersAtClient(position.x, position.y);

    const rows: Row[] = nodes.length
        ? [
              "copy",
              "cut",
              "pasteHere",
              "pasteReplace",
              "separator",
              { id: "addMotion", label: "Add motion", run: () => setMode("motion") },
              "separator",
              "front",
              "back",
              "separator",
              "group",
              "frame",
              ...(hasGroup ? ["ungroup"] : []),
              "section",
              "mask",
              ...(single?.type === "frame" ? [{ id: "toSection", label: single.isSection ? "Convert to frame" : "Convert to section", run: () => ACTION_BY_ID.get("toSection")?.run() }] : []),
              ...(single && (single.type === "frame" || single.type === "component") ? [thumbnailFrame() === single.id ? { id: "thumb", label: "Restore default thumbnail", run: () => restoreDefaultThumbnail() } : { id: "thumb", label: "Set as thumbnail", run: () => setAsThumbnail(single.id) }] : []),
              ...devStatusMenuItems(position.x, position.y),
              "separator",
              hasLayout ? "noLayout" : "layout",
              ...(hasLayout ? [] : ["suggestLayout"]),
              ...(single?.type === "component" || single?.type === "componentSet"
                  ? [{ id: "instance", label: "Create instance", run: () => createInstance(single.id) }]
                  : single?.type === "instance"
                    ? ["mainComponent", "detach", "resetInstance"]
                    : ["component"]),
              ...systemsMenuItems(doc, nodes.filter((n): n is NonNullable<typeof n> => Boolean(n))),
              ...(nodes.length > 1 ? ["separator", "union", "subtract", "intersect", "exclude", { id: "tidy", label: "Tidy up", shortcut: "⌃ ⌥ T", run: () => tidyUp() }] : []),
              ...(nodes.length && !nodes.some((n) => n && (n.type === "frame" || n.type === "component" || n.type === "instance" || n.type === "componentSet")) && !(single && single.type === "vector") ? ["flatten"] : []),
              ...(nodes.some((n) => n && n.strokes?.some((p) => p.visible !== false) && n.strokeWidth > 0 && n.type !== "frame" && n.type !== "text") ? ["outline"] : []),
              ...(single && (single.type === "vector" || single.type === "rect" || single.type === "ellipse") && !single.sourceId ? [{ id: "edit", label: "Edit points", shortcut: "↵", run: () => enterVectorEdit(single.id) }] : []),
              ...(single?.type === "vector" && !state.readOnly && (single.path?.subpaths.length ?? 0) > 1 ? ["splitVector"] : []),
              ...(!state.readOnly && nodes.length && nodes.every((n) => n && (n.type === "vector" || n.type === "rect" || n.type === "ellipse") && !n.sourceId) ? ["offsetPath", "simplifyPath"] : []),
              ...(single && !state.readOnly && canMakeBrush(doc, single)
                  ? [
                        { id: "brushStretch", label: "Create stretch brush", run: () => createBrush("stretch") },
                        { id: "brushScatter", label: "Create scatter brush", run: () => createBrush("scatter") },
                    ]
                  : []),
              ...(single && pdfPaint(single) ? [{ id: "pdf", label: "Organize PDF pages", run: () => openPdfEditor(single.id) }] : []),
              ...(single && pdfPaint(single) && !state.readOnly
                  ? [
                        isEditablePage(single)
                            ? { id: "pdfFlatten", label: "Flatten page to image", run: () => void flattenPdfPage(single.id) }
                            : { id: "pdfEditable", label: "Make page editable", run: () => void makePdfPageEditable(single.id) },
                    ]
                  : []),
              ...(single && firstImagePaint(single) >= 0 ? [{ id: "photo", label: "Edit in Photo", run: () => openPhotoEditor(single.id) }] : []),
              "separator",
              "visible",
              "lock",
              "separator",
              "flipx",
              "flipy",
          ]
        : ["pasteHere", "selectAll", "separator", ...(collab.get().status === "live" ? ["cursorChat", "separator"] : []), "fit", "panels", "toggleComments", "rulers", "cursors", ...(Object.values(doc.nodes).some((n) => n.interactions?.length) && !state.readOnly ? ["separator", "removeInteractions"] : [])];

    const resolved = rows.map((row) => {
        if (row === "separator" || typeof row !== "string") return row;
        const action = ACTION_BY_ID.get(row);
        if (!action) return "separator" as const;
        const label =
            row === "rulers"
                ? state.prefs.rulers
                    ? "Hide rulers"
                    : "Show rulers"
                : row === "toggleComments"
                  ? collab.get().commentsHidden
                      ? "Show comments"
                      : "Hide comments"
                  : row === "cursors"
                  ? state.prefs.multiplayerCursors
                      ? "Hide multiplayer cursors"
                      : "Show multiplayer cursors"
                  : (SHORT_LABELS[row] ?? actionLabel(action, state));
        // "Paste here" puts the copies' top-left where the menu was opened.
        const run =
            row === "pasteHere"
                ? () => {
                      const world = worldAtClient(position.x, position.y);
                      if (world) pasteAt(world);
                      else paste();
                  }
                : action.run;
        return { id: row, label, shortcut: action.shortcut, run, disabled: !actionEnabled(action, state) };
    });
    const actions = new Map(resolved.filter((r) => r !== "separator").map((r) => [r.id, r]));
    const disabled = [...actions.values()].filter((r) => "disabled" in r && r.disabled).map((r) => r.id);

    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: position.x, top: position.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && editor.set({ contextMenu: null })} placement="bottom start" offset={2} className={`${MENU_CLASS} max-h-[calc(100vh-16px)] overflow-y-auto`}>
                <AriaMenu
                    autoFocus="first"
                    aria-label="Layer actions"
                    className="outline-none"
                    disabledKeys={disabled}
                    onAction={(key) => {
                        editor.set({ contextMenu: null });
                        actions.get(String(key))?.run();
                    }}
                >
                    {under.length > 0 && <SelectLayerSubmenu layers={under} menuClass={MENU_CLASS} />}
                    {nodes.length > 0 && <MoveToPageSubmenu menuClass={MENU_CLASS} />}
                    {nodes.length > 0 && <CopyPasteAsSubmenu />}
                    {(under.length > 0 || nodes.length > 0) && <AriaSeparator className="my-1 h-px bg-white/10" />}
                    {resolved.map((row, i) => (row === "separator" ? <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" /> : <MenuRow key={row.id} id={row.id} label={row.label} shortcut={row.shortcut} />))}
                </AriaMenu>
            </AriaPopover>
        </>
    );
}

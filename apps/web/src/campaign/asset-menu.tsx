import { useRef } from "react";
import { Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { ContextMenu } from "../components/context-menu";
import { MenuRow } from "../components/left-sidebar";
import { ACTION_BY_ID } from "../engine/menu-actions";
import { editor, useEditor } from "../engine/store";
import { worldAtClient } from "../engine/layers-under";
import { assetData, assetsOf, deleteAssets, duplicateAssets, inRow, moveAssetToRow, pageData, reorderAsset, rowsOf, setTemplate } from "./model";
import { campaign } from "./state";

// The right-click menu for assets (on the canvas, in the asset list, the strip and Bulk edit):
// duplicate, delete, copy and paste properties, their order in the row, the row they sit in, the
// template switch, review and export. Layers inside an asset get the design editor's own menu.

const MENU_CLASS = "w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none";

// Opens the asset menu at a window point for an asset (selecting it unless it's already selected).
export function openAssetMenu(id: string, x: number, y: number) {
    const s = editor.get();
    if (!s.selection.includes(id)) editor.set({ selection: [id], editingTextId: null });
    editor.set({ contextMenu: { x, y } });
}

export function CampaignContextMenu() {
    const position = useEditor((s) => s.contextMenu);
    const onAssets = useEditor((s) => s.selection.length > 0 && s.selection.every((id) => assetData(s.doc.nodes[id])));
    if (!position) return null;
    // A right-click on an asset's own backdrop (nothing under it) picks the asset.
    if (!onAssets && !editor.get().selection.length) {
        const world = worldAtClient(position.x, position.y);
        const doc = editor.get().doc;
        const hit = world ? assetsOf(doc).find((a) => world.x >= a.x && world.x <= a.x + a.w && world.y >= a.y && world.y <= a.y + a.h) : undefined;
        if (hit) {
            queueMicrotask(() => editor.set({ selection: [hit.id] }));
            return null;
        }
    }
    return onAssets ? <AssetMenuBody position={position} /> : <ContextMenu />;
}

type Row = { id: string; label: string; shortcut?: string; run: () => void; disabled?: boolean } | "separator";

function AssetMenuBody({ position }: { position: { x: number; y: number } }) {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const anchor = useRef<HTMLDivElement>(null);
    const ids = selection.filter((id) => assetData(doc.nodes[id]));
    const single = ids.length === 1 ? doc.nodes[ids[0] ?? ""] : undefined;
    const data = assetData(single);
    const rows = rowsOf(doc);
    const row = data ? rows.find((v) => v.row.id === data.rowId) : undefined;
    const at = single && row ? row.assets.findIndex((a) => a.id === single.id) : -1;
    const last = row ? row.assets.length - 1 : 0;
    const close = () => editor.set({ contextMenu: null });
    const action = (id: string) => ACTION_BY_ID.get(id);
    const items: Row[] = readOnly
        ? [{ id: "export", label: ids.length > 1 ? `Export ${ids.length} assets…` : "Export…", shortcut: "⇧ ⌘ E", run: () => campaign.set({ dialog: { kind: "export", ids } }) }]
        : [
              { id: "duplicate", label: "Duplicate", shortcut: "⌘ D", run: () => duplicateAssets(ids) },
              { id: "delete", label: "Delete", shortcut: "⌫", run: () => deleteAssets(ids) },
              "separator",
              { id: "copyProps", label: "Copy properties", shortcut: action("copyProps")?.shortcut, run: () => action("copyProps")?.run() },
              { id: "pasteProps", label: "Paste properties", shortcut: action("pasteProps")?.shortcut, run: () => action("pasteProps")?.run() },
              "separator",
              ...(single && data
                  ? ([
                        { id: "template", label: data.template ? "Stop using as template" : "Use as template", run: () => setTemplate(single.id, !data.template) },
                        { id: "resize", label: "Resize to…", run: () => campaign.set({ dialog: { kind: "resize", assetId: single.id } }) },
                    ] as Row[])
                  : []),
              { id: "review", label: "Request review…", run: () => campaign.set({ dialog: { kind: "review", ids } }) },
              { id: "export", label: ids.length > 1 ? `Export ${ids.length} assets…` : "Export…", shortcut: "⇧ ⌘ E", run: () => campaign.set({ dialog: { kind: "export", ids } }) },
          ];
    const runs = new Map(items.flatMap((r) => (r === "separator" ? [] : [[r.id, r.run] as const])));
    const order: Row[] = [
        { id: "first", label: "Move to start of row", run: () => single && reorderAsset(single.id, "first"), disabled: at <= 0 },
        { id: "earlier", label: "Move earlier", run: () => single && reorderAsset(single.id, "earlier"), disabled: at <= 0 },
        { id: "later", label: "Move later", run: () => single && reorderAsset(single.id, "later"), disabled: at < 0 || at >= last },
        { id: "last", label: "Move to end of row", run: () => single && reorderAsset(single.id, "last"), disabled: at < 0 || at >= last },
    ];
    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: position.x, top: position.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && close()} placement="bottom start" offset={2} className={`${MENU_CLASS} max-h-[calc(100vh-16px)] overflow-y-auto`}>
                <AriaMenu
                    autoFocus="first"
                    aria-label="Asset actions"
                    className="outline-none"
                    onAction={(key) => {
                        close();
                        runs.get(String(key))?.();
                    }}
                >
                    {items.map((r, i) => (r === "separator" ? <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" /> : <MenuRow key={r.id} id={r.id} label={r.label} shortcut={r.shortcut} />))}
                    {!readOnly && single && (
                        <>
                            <AriaSeparator className="my-1 h-px bg-white/10" />
                            <AriaSubmenuTrigger>
                                <MenuRow id="order" label="Order" shortcut="›" />
                                <AriaPopover offset={-4} className={MENU_CLASS}>
                                    <AriaMenu
                                        aria-label="Order"
                                        className="outline-none"
                                        disabledKeys={order.flatMap((r) => (r !== "separator" && r.disabled ? [r.id] : []))}
                                        onAction={(key) => {
                                            close();
                                            for (const r of order) if (r !== "separator" && r.id === key) r.run();
                                        }}
                                    >
                                        {order.map((r) => (r === "separator" ? null : <MenuRow key={r.id} id={r.id} label={r.label} />))}
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaSubmenuTrigger>
                            <AriaSubmenuTrigger>
                                <MenuRow id="row" label="Move to row" shortcut="›" />
                                <AriaPopover offset={-4} className={MENU_CLASS}>
                                    <AriaMenu
                                        aria-label="Move to row"
                                        className="outline-none"
                                        onAction={(key) => {
                                            close();
                                            void inRow(String(key), (row) => moveAssetToRow(single.id, row));
                                        }}
                                    >
                                        {pageData(doc).rows.map((r) => (
                                            <MenuRow key={r.id} id={r.id} label={r.name} checked={r.id === data?.rowId} />
                                        ))}
                                        <AriaSeparator className="my-1 h-px bg-white/10" />
                                        <MenuRow id="new" label="New row" />
                                    </AriaMenu>
                                </AriaPopover>
                            </AriaSubmenuTrigger>
                        </>
                    )}
                </AriaMenu>
            </AriaPopover>
        </>
    );
}

import { Lock01 } from "@untitledui/icons";
import { Menu as AriaMenu, MenuItem as AriaMenuItem, Popover as AriaPopover, SubmenuTrigger as AriaSubmenuTrigger } from "react-aria-components";
import { editor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { MenuRow } from "./left-sidebar";
import { isReusable, layerIcon } from "./layer-kind";

// "Select layer ▸": every layer under the cursor, deepest first, each with its icon. Hovering a row
// outlines that layer on the canvas; choosing it selects it (locked layers too, as in the Layers panel).
export function SelectLayerSubmenu({ layers, menuClass }: { layers: SceneNode[]; menuClass: string }) {
    return (
        <AriaSubmenuTrigger>
            <MenuRow id="selectLayer" label="Select layer" shortcut="›" />
            <AriaPopover offset={-4} className={`${menuClass} max-h-[60vh] overflow-y-auto`}>
                <AriaMenu
                    aria-label="Select layer"
                    className="outline-none"
                    onAction={(key) => {
                        editor.set({ contextMenu: null, hoverId: null, selection: [String(key)] });
                    }}
                    onClose={() => editor.set({ hoverId: null })}
                >
                    {layers.map((node) => {
                        const Icon = layerIcon(node);
                        return (
                            <AriaMenuItem
                                key={node.id}
                                id={node.id}
                                textValue={node.name}
                                onHoverChange={(on) => editor.set({ hoverId: on ? node.id : null })}
                                onFocus={() => editor.set({ hoverId: node.id })}
                                className="flex h-7 cursor-default items-center gap-2 rounded px-2 text-[11px] outline-none data-[focused]:bg-brand-500"
                            >
                                <Icon className={`size-3.5 shrink-0 ${isReusable(node) ? "text-[#B67CFF]" : "text-white/70"}`} />
                                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                                {node.locked && <Lock01 className="size-3 shrink-0 text-white/50" aria-label="Locked" />}
                            </AriaMenuItem>
                        );
                    })}
                </AriaMenu>
            </AriaPopover>
        </AriaSubmenuTrigger>
    );
}

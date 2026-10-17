import { useRef } from "react";
import { Menu as AriaMenu, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { MenuRow } from "./left-sidebar";

// A right-click menu at the pointer, for lists in panels and popovers (styles, assets).
export type PointMenuItem = { id: string; label: string; shortcut?: string; disabled?: boolean; run: () => void } | "separator";

export function PointMenu({ at, items, onClose, label = "Actions" }: { at: { x: number; y: number } | null; items: PointMenuItem[]; onClose: () => void; label?: string }) {
    const anchor = useRef<HTMLDivElement>(null);
    if (!at) return null;
    const actions = new Map(items.filter((i): i is Exclude<PointMenuItem, "separator"> => i !== "separator").map((i) => [i.id, i]));
    return (
        <>
            <div ref={anchor} className="pointer-events-none fixed size-0" style={{ left: at.x, top: at.y }} />
            <AriaPopover triggerRef={anchor} isOpen onOpenChange={(open) => !open && onClose()} placement="bottom start" offset={2} className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    autoFocus="first"
                    aria-label={label}
                    className="outline-none"
                    disabledKeys={[...actions.values()].filter((i) => i.disabled).map((i) => i.id)}
                    onAction={(key) => {
                        onClose();
                        actions.get(String(key))?.run();
                    }}
                >
                    {items.map((item, i) => (item === "separator" ? <AriaSeparator key={`sep-${i}`} className="my-1 h-px bg-white/10" /> : <MenuRow key={item.id} id={item.id} label={item.label} shortcut={item.shortcut} />))}
                </AriaMenu>
            </AriaPopover>
        </>
    );
}

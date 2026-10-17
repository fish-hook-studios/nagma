import type { ReactNode } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";

// A small dark menu (the reference's style) opened from a button, for the collaboration panels.
export type MenuEntry = { id: string; label: string; shortcut?: string; checked?: boolean; disabled?: boolean; section?: never } | "-" | { section: string };

export function DarkMenu({
    label,
    trigger,
    items,
    onAction,
    placement = "bottom end",
    className = "flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink",
    width = "w-56",
}: {
    label: string;
    trigger: ReactNode;
    items: MenuEntry[];
    onAction: (id: string) => void;
    placement?: "bottom end" | "bottom start" | "top end" | "top start" | "left top" | "right top";
    className?: string;
    width?: string;
}) {
    const disabled = items.flatMap((i) => (typeof i === "object" && "id" in i && i.disabled ? [i.id] : []));
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={label} className={className}>
                {trigger}
            </AriaButton>
            <AriaPopover placement={placement} offset={4} className={`${width} rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none`}>
                <AriaMenu className="outline-none" onAction={(key) => onAction(String(key))} disabledKeys={disabled}>
                    {items.map((item, i) =>
                        item === "-" ? (
                            <AriaSeparator key={`sep${i}`} className="my-1 h-px bg-white/10" />
                        ) : "section" in item && item.section !== undefined ? (
                            <AriaMenuItem key={`sec${i}`} id={`section:${i}`} isDisabled className="px-2 pt-1.5 pb-1 text-[10px] font-medium text-white/50 outline-none">
                                {item.section}
                            </AriaMenuItem>
                        ) : (
                            <AriaMenuItem
                                key={item.id}
                                id={item.id}
                                className="flex h-7 cursor-default items-center justify-between gap-4 rounded px-2 text-[11px] outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500"
                            >
                                <span className="flex items-center gap-2">
                                    {item.checked !== undefined && <span className="w-3 text-center">{item.checked ? "✓" : ""}</span>}
                                    {item.label}
                                </span>
                                {item.shortcut && <span className="text-white/50">{item.shortcut}</span>}
                            </AriaMenuItem>
                        ),
                    )}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

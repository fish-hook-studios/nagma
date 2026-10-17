import { ChevronDown, ChevronLeft, ChevronRight } from "@untitledui/icons";
import type { ReactNode } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { Avatar } from "./avatar";

// The account row at the top of the file browser's sidebar (and the admin console's): your
// avatar and name opening the account menu, with the notifications bell on the right.
export function SidebarAccount({ name, color, avatar, bell, onAction, children, divided, server }: { name: string; color: string; avatar?: string | null; bell: ReactNode; onAction: (key: string) => void; children: ReactNode; divided?: boolean; server?: ReactNode }) {
    return (
        <div className={`flex shrink-0 items-center gap-2 pr-3 pl-2 ${divided ? "h-[49px] border-b border-panel-border" : "h-[48px]"}`}>
            <AriaMenuTrigger>
                <AriaButton className="flex min-w-0 items-center gap-[9px] rounded-md py-1 pr-1.5 pl-1 outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                    <Avatar name={name} color={color} size={24} single src={avatar} />
                    <span className="truncate text-[13.5px] font-medium">{name}</span>
                    <ChevronDown className="-ml-1 size-2.5 shrink-0" />
                </AriaButton>
                <AriaPopover placement="bottom start" offset={4} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu className="outline-none" aria-label="Account" onAction={(key) => onAction(String(key))}>
                        {children}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            {server}
            <div className="flex-1" />
            {bell}
        </div>
    );
}

// Back and forward through the places visited, at the left of the file browser's top bar.
export function HistoryButtons({ canBack, canForward, onBack, onForward }: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void }) {
    const look = "flex size-6 items-center justify-center rounded-md text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 disabled:text-ink-subtle disabled:hover:bg-transparent";
    return (
        <>
            <AriaButton aria-label="Back" isDisabled={!canBack} onPress={onBack} className={look}>
                <ChevronLeft className="size-4" />
            </AriaButton>
            <AriaButton aria-label="Forward" isDisabled={!canForward} onPress={onForward} className={look}>
                <ChevronRight className="size-4" />
            </AriaButton>
        </>
    );
}

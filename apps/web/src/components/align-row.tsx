import { AlignBottom01, AlignHorizontalCentre01, AlignLeft01, AlignRight01, AlignTopArrow01, AlignVerticalCenter01 } from "@untitledui/icons";
import type { FC, SVGProps } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { alignSelection, distributeSelection, tidyUp } from "../engine/arrange";
import { useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { MenuRow } from "./left-sidebar";
import { ICON_BUTTON, JOINED, JOINED_BUTTON, ROW } from "./panel-section";

// The Position section's align row, like the reference: horizontal and vertical alignments as two
// joined 88pt groups of three (⇧-click aligns each layer to its parent instead of to each other),
// then the distribute button with Distribute and Tidy up.

type Mode = Parameters<typeof alignSelection>[0];

const ALIGNS: { mode: Mode; icon: FC<SVGProps<SVGSVGElement>>; label: string; shortcut: string }[] = [
    { mode: "left", icon: AlignLeft01, label: "Align left", shortcut: "⌥ A" },
    { mode: "hcenter", icon: AlignHorizontalCentre01, label: "Align horizontal centers", shortcut: "⌥ H" },
    { mode: "right", icon: AlignRight01, label: "Align right", shortcut: "⌥ D" },
    { mode: "top", icon: AlignTopArrow01, label: "Align top", shortcut: "⌥ W" },
    { mode: "vcenter", icon: AlignVerticalCenter01, label: "Align vertical centers", shortcut: "⌥ V" },
    { mode: "bottom", icon: AlignBottom01, label: "Align bottom", shortcut: "⌥ S" },
];

// Three lines spaced evenly: the distribute menu's button.
function DistributeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" {...props}>
            <path d="M3 3h10M3 13h10" />
            <rect x="5" y="6" width="6" height="4" rx="1" />
        </svg>
    );
}

export function AlignRow({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const onlyParent = nodes.length === 1 ? doc.nodes[nodes[0]?.parentId ?? ""] : undefined;
    const disabled = nodes.length === 1 && (!onlyParent || onlyParent.type === "page");
    const many = nodes.length >= 2;
    const group = (items: typeof ALIGNS) => (
        <div className={JOINED}>
            {items.map(({ mode, icon: Icon, label, shortcut }) => (
                <AriaTooltipTrigger key={mode} delay={500} closeDelay={0}>
                    <AriaButton aria-label={label} isDisabled={disabled} onPress={(e) => alignSelection(mode, e.shiftKey)} className={JOINED_BUTTON}>
                        <Icon className="size-3.5" />
                    </AriaButton>
                    <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                        {label}
                        <span className="ml-2 text-white/50">{shortcut}</span>
                        {many && <div className="text-white/50">⇧-click to align to parent</div>}
                    </AriaTooltip>
                </AriaTooltipTrigger>
            ))}
        </div>
    );
    return (
        <div className={ROW}>
            {group(ALIGNS.slice(0, 3))}
            {group(ALIGNS.slice(3))}
            <AriaMenuTrigger>
                <AriaButton aria-label="More alignment options" className={ICON_BUTTON}>
                    <DistributeIcon className="size-4" />
                </AriaButton>
                <AriaPopover placement="bottom end" className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        className="outline-none"
                        disabledKeys={[...(nodes.length < 3 ? ["dh", "dv"] : []), ...(nodes.length < 2 ? ["tidy"] : [])]}
                        onAction={(k) => {
                            if (k === "dh") distributeSelection("h");
                            if (k === "dv") distributeSelection("v");
                            if (k === "tidy") tidyUp();
                        }}
                    >
                        <MenuRow id="dh" label="Distribute horizontal spacing" shortcut="⌃ ⌥ H" />
                        <MenuRow id="dv" label="Distribute vertical spacing" shortcut="⌃ ⌥ V" />
                        <MenuRow id="tidy" label="Tidy up" shortcut="⌃ ⌥ T" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}

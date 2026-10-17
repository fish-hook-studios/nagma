import type { FC, ReactNode, SVGProps } from "react";
import { Button as AriaButton, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";

interface IconButtonProps {
    icon: FC<SVGProps<SVGSVGElement>>;
    label: string;
    shortcut?: string;
    active?: boolean;
    disabled?: boolean;
    size?: "sm" | "md";
    tone?: "light" | "dark";
    onPress?: () => void;
    children?: ReactNode;
}

export function IconButton({ icon: Icon, label, shortcut, active, disabled, size = "md", tone = "light", onPress }: IconButtonProps) {
    const box = size === "sm" ? "size-6" : "size-8";
    const iconSize = size === "sm" ? "size-3.5" : "size-4";
    const colors =
        tone === "dark"
            ? active
                ? "bg-brand-500 text-white"
                : "text-white/85 hover:bg-white/10"
            : active
              ? "bg-brand-100 text-brand-500"
              : "text-ink-muted hover:bg-panel-hover hover:text-ink";

    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton
                aria-label={label}
                isDisabled={disabled}
                onPress={onPress}
                className={`${box} ${colors} flex shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-35`}
            >
                <Icon className={iconSize} />
            </AriaButton>
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

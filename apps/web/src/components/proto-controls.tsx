import { Check, ChevronDown } from "@untitledui/icons";
import { createContext, useContext } from "react";
import { Button as AriaButton, Header as AriaHeader, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Section as AriaSection, Separator as AriaSeparator } from "react-aria-components";
import type { ActionType, VariableType } from "../engine/types";

// Small pieces shared by the Prototype tab and the Interaction window: the reference's compact dropdowns,
// label and value rows, checkboxes and the icons for actions.

export interface PickOption {
    id: string;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}

// Menus and windows that belong to the Interaction window (clicks in them keep it open).
export const KEEP_OPEN = "data-interaction-keep";

// Inside the Interaction popover, dropdowns are outlined 28px fields (the reference's look there); elsewhere
// (the Prototype panel) they keep the filled compact style.
export const OutlineFields = createContext(false);

// A compact dropdown: a field-like button with an optional icon, and a grouped menu with a check
// on the current value.
export function Pick({
    label,
    value,
    groups,
    onChange,
    icon,
    placeholder,
    className = "w-full",
    headings,
    children,
}: {
    label: string;
    value: string | null;
    groups: PickOption[][];
    onChange: (id: string) => void;
    icon?: React.ReactNode;
    placeholder?: string;
    className?: string;
    // A heading over each group (by index in `groups`), or undefined for none.
    headings?: (string | undefined)[];
    // A custom trigger in place of the field-like button.
    children?: React.ReactNode;
}) {
    const all = groups.flat();
    const current = all.find((o) => o.id === value);
    const shown = groups.map((g, i) => ({ items: g, heading: headings?.[i] })).filter((g) => g.items.length);
    const outline = useContext(OutlineFields);
    const field = outline ? "h-6 rounded-[5px] border-[var(--color-toolbar-ring)] bg-transparent hover:border-ink-subtle" : "h-6 rounded-md border-transparent bg-field hover:border-panel-border";
    // Outlined (the Interaction popover): the menu opens over the field, 154 wide, the current item
    // level with the field (as a macOS pop-up menu).
    let over = 8;
    for (const [gi, g] of shown.entries()) {
        const at = g.items.findIndex((o) => o.id === value);
        if (gi > 0) over += 9;
        if (g.heading) over += 24;
        if (at >= 0) {
            over += at * 24;
            break;
        }
        over += g.items.length * 24;
    }
    return (
        <AriaMenuTrigger>
            {children ?? (
                <AriaButton aria-label={label} className={`flex min-w-0 items-center gap-1.5 border pr-2 pl-2 text-left text-ink outline-none focus-visible:border-brand-500 disabled:opacity-50 data-[pressed]:border-ink-subtle ${field} ${className}`}>
                    {(icon ?? current?.icon) && <span className="flex size-4 shrink-0 items-center justify-center text-ink-muted">{icon ?? current?.icon}</span>}
                    <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-ink-subtle"}`}>{current?.label ?? placeholder ?? "None"}</span>
                    <ChevronDown className="size-3 shrink-0 text-ink-subtle" />
                </AriaButton>
            )}
            <AriaPopover placement="bottom start" offset={outline && current ? -(24 + over) : 4} crossOffset={outline ? -8 : 0} shouldFlip={!outline} className="outline-none">
                <div {...{ [KEEP_OPEN]: "" }} className={`max-h-[70vh] overflow-y-auto bg-tooltip text-white shadow-xl ${outline ? "w-[154px] rounded-[13px] p-2" : "min-w-44 rounded-lg p-1"}`}>
                    <AriaMenu aria-label={label} className="outline-none" disabledKeys={all.filter((o) => o.disabled).map((o) => o.id)} onAction={(key) => onChange(String(key))}>
                        {shown.map(({ items: group, heading }, gi) => (
                            <AriaSection key={group.map((o) => o.id).join()}>
                                {gi > 0 && <AriaSeparator className="my-1 h-px bg-white/10" />}
                                {heading && <AriaHeader className="flex h-6 items-center pr-3 pl-6 text-[11px] text-white/50">{heading}</AriaHeader>}
                                {group.map((o) => (
                                    <AriaMenuItem
                                        key={o.id}
                                        id={o.id}
                                        textValue={o.label}
                                        className="flex h-6 cursor-default items-center gap-2 rounded-md pr-3 pl-1.5 text-[12px] text-white outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500"
                                    >
                                        <span className="flex w-3 shrink-0 justify-center">{o.id === value && <Check className="size-3" />}</span>
                                        {o.icon && <span className="flex size-4 shrink-0 items-center justify-center opacity-80">{o.icon}</span>}
                                        <span className="truncate">{o.label}</span>
                                    </AriaMenuItem>
                                ))}
                            </AriaSection>
                        ))}
                    </AriaMenu>
                </div>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

// A label on the left and its control on the right.
export function Row({ label, children, align = "center" }: { label: React.ReactNode; children: React.ReactNode; align?: "center" | "start" }) {
    // In the Interaction popover: 24pt rows (32 apart), the field 137 wide after a 69pt label.
    const outline = useContext(OutlineFields);
    return (
        <div className={`grid ${outline ? "min-h-6 grid-cols-[69px_minmax(0,1fr)]" : "min-h-7 grid-cols-[76px_minmax(0,1fr)]"} ${align === "center" ? "items-center" : "items-start"}`}>
            <span className={`truncate pr-2 text-ink ${align === "start" ? "pt-1.5" : ""}`}>{label}</span>
            <div className="flex min-w-0 items-center gap-1">{children}</div>
        </div>
    );
}

export function Divider() {
    return <div className="-mx-3 my-2 h-px bg-panel-border" />;
}

export function CheckRow({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
    return (
        <label className={`flex h-6 items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-brand-500" />
            <span className="text-ink">{label}</span>
            {hint && (
                <span title={hint} aria-label={hint} className="flex size-3.5 items-center justify-center rounded-full border border-ink-subtle text-[9px] leading-none text-ink-subtle">
                    i
                </span>
            )}
        </label>
    );
}

// Icons for each kind of action, drawn here on a 16 unit grid.
export function ActionIcon({ kind, className = "size-4" }: { kind: ActionType | "none" | string; className?: string }) {
    const k = kind.startsWith("video") ? "video" : kind;
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {k === "none" && (
                <>
                    <circle cx="8" cy="8" r="5" />
                    <path d="M4.5 11.5l7-7" />
                </>
            )}
            {k === "navigate" && <path d="M3 8h9.5M9 4.5L12.5 8 9 11.5" />}
            {k === "change-to" && (
                <>
                    <path d="M8 2.5l2.5 2.5L8 7.5 5.5 5z" />
                    <path d="M8 8.5l2.5 2.5L8 13.5 5.5 11z" />
                </>
            )}
            {k === "back" && <path d="M13 8H3.5M7 4.5L3.5 8 7 11.5" />}
            {k === "scroll-to" && <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3.5 13.5h9" />}
            {k === "url" && (
                <>
                    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7" />
                    <path d="M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7" />
                </>
            )}
            {k === "set-variable" && (
                <>
                    <circle cx="8" cy="8" r="5.5" />
                    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
                </>
            )}
            {k === "set-mode" && (
                <>
                    <circle cx="8" cy="8" r="5.5" />
                    <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
                </>
            )}
            {k === "conditional" && (
                <>
                    <circle cx="4.5" cy="3.5" r="1.5" />
                    <circle cx="4.5" cy="12.5" r="1.5" />
                    <circle cx="11.5" cy="6" r="1.5" />
                    <path d="M4.5 5v6M11.5 7.5c0 2-2 2.5-7 3.5" />
                </>
            )}
            {k === "overlay" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                    <rect x="5" y="6" width="6" height="5" rx="1" fill="currentColor" fillOpacity="0.35" />
                </>
            )}
            {k === "swap" && <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />}
            {k === "close" && (
                <>
                    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                    <path d="M6 6l4 4M10 6l-4 4" />
                </>
            )}
            {k === "video" && (
                <>
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
                    <path d="M7 6.2v3.6L10 8z" fill="currentColor" stroke="none" />
                </>
            )}
            {k === "animation" && (
                <>
                    <path d="M3 4.5v7L8 8z" fill="currentColor" fillOpacity="0.35" />
                    <path d="M10.5 4.5v7M13 4.5v7" />
                </>
            )}
            {k === "set-playhead" && (
                <>
                    <path d="M2.5 10.5h11" />
                    <path d="M8 6v7" />
                    <path d="M6.5 3h3v1.8L8 6 6.5 4.8z" fill="currentColor" fillOpacity="0.35" />
                </>
            )}
        </svg>
    );
}

// The trigger mark in the Trigger field: a pointer, a key, a clock.
export function TriggerIcon({ trigger, className = "size-4" }: { trigger: string; className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {trigger === "none" ? (
                <>
                    <circle cx="8" cy="8" r="5" />
                    <path d="M4.5 11.5l7-7" />
                </>
            ) : trigger === "key" ? (
                <>
                    <rect x="2" y="4" width="12" height="8" rx="1.5" />
                    <path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h-.5M5 9.5h6" />
                </>
            ) : trigger === "delay" ? (
                <>
                    <circle cx="8" cy="8.5" r="5" />
                    <path d="M8 6v2.5l1.8 1.2M6.5 2h3" />
                </>
            ) : trigger.startsWith("video") ? (
                <>
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
                    <path d="M7 6.2v3.6L10 8z" fill="currentColor" stroke="none" />
                </>
            ) : trigger === "click" ? (
                <>
                    <path d="M7 6.5l6 3.5-2.6.7 1.5 2.8-1 .5-1.5-2.8L7.4 13z" />
                    <path d="M5.5 1.5v2M2 5h2M2.8 2.3l1.4 1.4M8.2 2.3L6.8 3.7" />
                </>
            ) : trigger === "drag" ? (
                <path d="M8 2v12M2 8h12M8 2L6.5 3.5M8 2l1.5 1.5M8 14l-1.5-1.5M8 14l1.5-1.5M2 8l1.5-1.5M2 8l1.5 1.5M14 8l-1.5-1.5M14 8l-1.5 1.5" />
            ) : trigger === "hover" ? (
                <>
                    <ellipse cx="8" cy="12.5" rx="5" ry="1.5" />
                    <path d="M6 2.5l6 3.6-2.6.7 1.4 2.6-1 .5-1.4-2.6L6.4 9z" />
                </>
            ) : trigger === "press" ? (
                <>
                    <ellipse cx="8" cy="12" rx="5.5" ry="2" />
                    <ellipse cx="8" cy="12" rx="2.5" ry=".8" />
                    <path d="M8 2v6M6 6l2 2 2-2" />
                </>
            ) : trigger === "mouse-enter" || trigger === "mouse-leave" ? (
                <>
                    <path d="M9 2.5h3a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H9" />
                    <path d={trigger === "mouse-enter" ? "M2.5 8h7M7 5.5L9.5 8 7 10.5" : "M9.5 8h-7M5 5.5L2.5 8 5 10.5"} />
                </>
            ) : trigger === "mouse-down" || trigger === "mouse-up" ? (
                <>
                    <rect x="4" y="2" width="8" height="12" rx="4" />
                    <path d="M8 2v4M4 6h8" />
                    {trigger === "mouse-down" && <path d="M4.5 6h7v1.5c0 1-1 2-3.5 2s-3.5-1-3.5-2z" fill="currentColor" stroke="none" />}
                </>
            ) : (
                <path d="M4 2.5l8 5-3.6.9 2.1 3.9-1.4.7-2.1-3.9L4.5 11.5z" />
            )}
        </svg>
    );
}

const TYPE_MARK: Record<VariableType, string> = { color: "◐", number: "#", string: "T", boolean: "◑", easing: "∿", timing: "◷" };

export function VariableChip({ name, type }: { name: string; type?: VariableType }) {
    return (
        <span className="mx-px inline-flex max-w-full items-center gap-1 truncate rounded bg-panel-hover px-1 py-px align-middle text-ink">
            {type && <span className="text-[10px] text-ink-subtle">{TYPE_MARK[type]}</span>}
            <span className="truncate">{name}</span>
        </span>
    );
}

const OPERATOR = /(==|!=|<=|>=|<|>|\+|-|\*|\/|\band\b|\bor\b|\bnot\b)/;
const IS_OPERATOR = /^(==|!=|<=|>=|<|>|\+|-|\*|\/|and|or|not)$/;

// An expression drawn read-only: variables as chips, operators in pink.
export function ExpressionText({ src, nameOf }: { src: string; nameOf: (id: string) => { name: string; type?: VariableType } }) {
    const parts = src.split(/(\{\{[^}]+\}\})/g);
    return (
        <span className="min-w-0 truncate">
            {parts.map((part, i) => {
                const m = /^\{\{([^}]+)\}\}$/.exec(part);
                if (m) {
                    const v = nameOf((m[1] ?? "").trim());
                    return <VariableChip key={i} name={v.name} type={v.type} />;
                }
                return part.split(OPERATOR).map((bit, k) =>
                    IS_OPERATOR.test(bit) ? (
                        <span key={`${i}-${k}`} className="text-pink-500">
                            {bit}
                        </span>
                    ) : (
                        <span key={`${i}-${k}`}>{bit}</span>
                    ),
                );
            })}
        </span>
    );
}

import { Check, ChevronDown } from "@untitledui/icons";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, MenuSection as AriaSection, Separator as AriaSeparator, Header as AriaHeader } from "react-aria-components";

// The app's dropdown, in place of the browser's <select> (whose menu macOS draws in the system
// font): a field with the value and a chevron inset from the edge, and a dark menu in the app's
// font with a check on the current value. It takes the same <option> and <optgroup> children and
// calls onChange with an event-like object, so it drops in where a <select> was.

interface Item {
    value: string;
    label: string;
    disabled: boolean;
}
interface Group {
    label: string | null;
    items: Item[];
}

function text(node: ReactNode): string {
    let out = "";
    Children.forEach(node, (child) => {
        if (typeof child === "string" || typeof child === "number") out += String(child);
        else if (isValidElement<{ children?: ReactNode }>(child)) out += text(child.props.children);
    });
    return out;
}

function collect(children: ReactNode, groups: Group[]) {
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        const el = child as ReactElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>;
        if (el.type === Fragment) return collect(el.props.children, groups);
        if (el.type === "optgroup") {
            const group: Group = { label: el.props.label ?? null, items: [] };
            groups.push(group);
            collect(el.props.children, [group]);
            groups.push({ label: null, items: [] });
            return;
        }
        if (el.type === "option") {
            const label = text(el.props.children);
            const value = el.props.value !== undefined ? String(el.props.value) : label;
            (groups[groups.length - 1] as Group).items.push({ value, label, disabled: Boolean(el.props.disabled) });
        }
    });
}

export type SelectChange = { target: { value: string }; currentTarget: { value: string } };

export function Select({
    value,
    defaultValue,
    onChange,
    children,
    className = "",
    style,
    disabled,
    title,
    "aria-label": ariaLabel,
    onPreview,
}: {
    value?: string | number;
    defaultValue?: string | number;
    onChange?: (event: SelectChange) => void;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    title?: string;
    "aria-label"?: string;
    id?: string;
    name?: string;
    // Called with the option under the pointer while the menu is open, and null when it leaves.
    onPreview?: (value: string | null) => void;
}) {
    const groups: Group[] = [{ label: null, items: [] }];
    collect(children, groups);
    const shown = groups.filter((g) => g.items.length);
    const all = shown.flatMap((g) => g.items);
    const current = String(value ?? defaultValue ?? all[0]?.value ?? "");
    const selected = all.find((i) => i.value === current);
    const pick = (next: string) => onChange?.({ target: { value: next }, currentTarget: { value: next } });
    return (
        <AriaMenuTrigger>
            <AriaButton
                aria-label={ariaLabel ?? title}
                isDisabled={disabled}
                style={{ ...style, paddingRight: 8 }}
                className={`flex min-w-0 items-center gap-1.5 text-left outline-none disabled:opacity-50 ${className}`}
            >
                <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
                <ChevronDown className="size-3 shrink-0 text-ink-subtle" />
            </AriaButton>
            <AriaPopover placement="bottom start" offset={4} className="outline-none">
                <div className="max-h-[70vh] min-w-40 overflow-y-auto rounded-lg bg-tooltip p-1 font-sans text-white shadow-xl">
                    <AriaMenu aria-label={ariaLabel ?? title ?? "Options"} className="outline-none" disabledKeys={all.filter((i) => i.disabled).map((i) => i.value)} onAction={(key) => pick(String(key))}>
                        {shown.map((group, gi) => (
                            <AriaSection key={`${gi}:${group.label ?? ""}`}>
                                {gi > 0 && <AriaSeparator className="my-1 h-px bg-white/10" />}
                                {group.label && <AriaHeader className="px-2 pt-1 pb-0.5 text-[11px] text-white/50">{group.label}</AriaHeader>}
                                {group.items.map((item) => (
                                    <AriaMenuItem
                                        key={item.value}
                                        id={item.value}
                                        textValue={item.label}
                                        onHoverStart={onPreview ? () => onPreview(item.value) : undefined}
                                        onHoverEnd={onPreview ? () => onPreview(null) : undefined}
                                        className="flex h-7 cursor-default items-center gap-2 rounded-md pr-3 pl-1.5 text-[12px] text-white outline-none data-[disabled]:opacity-40 data-[focused]:bg-brand-500"
                                    >
                                        <span className="flex w-3 shrink-0 justify-center">{item.value === current && <Check className="size-3" />}</span>
                                        <span className="truncate">{item.label}</span>
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

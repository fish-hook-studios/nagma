import { Check, ChevronDown, InfoCircle, SearchSm, X } from "@untitledui/icons";
import type { FC, ReactNode, SVGProps } from "react";
import { Button as AriaButton, Dialog as AriaDialog, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Modal as AriaModal, ModalOverlay as AriaModalOverlay, Popover as AriaPopover } from "react-aria-components";
import { type Seat, SEAT_LABELS } from "../../engine/admin";

// Building blocks shared by the admin console and the Resources page.

const SEAT_ICONS: Record<Seat, FC<SVGProps<SVGSVGElement>>> = { view: ViewSeatIcon, collab: CollabSeatIcon, dev: DevSeatIcon, full: FullSeatIcon };
// Each seat type's colour: its icon, and the tinted square behind it in tables.
const SEAT_TONES: Record<Seat, { ink: string; chip: string }> = {
    view: { ink: "text-ink-muted", chip: "bg-field" },
    collab: { ink: "text-[#b58cff]", chip: "bg-[#b58cff]/20" },
    dev: { ink: "text-[#5fd07c]", chip: "bg-[#5fd07c]/20" },
    full: { ink: "text-[#7ab8f5]", chip: "bg-[#5a8fd8]/30" },
};
export function SeatIcon({ seat, className = "size-4", tinted }: { seat: Seat; className?: string; tinted?: boolean }) {
    const Icon = SEAT_ICONS[seat];
    return <Icon className={`${className} ${tinted ? SEAT_TONES[seat].ink : ""}`} aria-hidden />;
}

// "[icon] Full": the seat's icon on its tinted square, then its name.
export function SeatLabel({ seat }: { seat: Seat }) {
    return (
        <span className="inline-flex items-center gap-[9px]">
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-[5px] ${SEAT_TONES[seat].chip}`}>
                <SeatIcon seat={seat} tinted className="size-4" />
            </span>
            {SEAT_LABELS[seat]}
        </span>
    );
}

// A count in a small grey box, after a heading ("Requests 0") or before a seat icon.
export function CountBadge({ children }: { children: ReactNode }) {
    return <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] bg-field px-1 text-[11.5px] font-normal tabular-nums text-ink">{children}</span>;
}

function ViewSeatIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
            <path d="M10 2.75a7.25 7.25 0 1 1-4.6 12.86L2.75 17.25l.9-3.1A7.25 7.25 0 0 1 10 2.75Z" strokeLinejoin="round" />
            <circle cx="10" cy="10" r="3" />
        </svg>
    );
}
function CollabSeatIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
            <circle cx="7.5" cy="10" r="5" />
            <circle cx="12.5" cy="10" r="5" />
        </svg>
    );
}
function DevSeatIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" {...props}>
            <path d="M10 2.5v15M2.5 10h15M4.7 4.7l10.6 10.6M15.3 4.7 4.7 15.3" />
        </svg>
    );
}
function FullSeatIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}>
            <circle cx="10" cy="6.25" r="3.75" />
            <circle cx="10" cy="13.75" r="3.75" />
            <circle cx="6.25" cy="10" r="3.75" />
            <circle cx="13.75" cy="10" r="3.75" />
        </svg>
    );
}

export const field = "h-8 w-full rounded-md border border-panel-border bg-field px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500";

export function Button({ children, onPress, variant = "secondary", disabled, className = "", type = "button" }: { children: ReactNode; onPress?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; className?: string; type?: "button" | "submit" }) {
    const look =
        variant === "primary" ? "bg-button font-medium text-white hover:bg-brand-600"
        : variant === "danger" ? "border border-red-500/40 text-red-500 hover:bg-red-500/10"
        : variant === "ghost" ? "text-ink-muted hover:bg-panel-hover hover:text-ink"
        : "border border-panel-border text-ink hover:bg-panel-hover";
    return (
        <AriaButton type={type} isDisabled={disabled} onPress={onPress} className={`inline-flex h-[24px] shrink-0 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${look} ${className}`}>
            {children}
        </AriaButton>
    );
}

export function LinkButton({ children, onPress, className = "" }: { children: ReactNode; onPress?: () => void; className?: string }) {
    return (
        <AriaButton onPress={onPress} className={`rounded text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}>
            {children}
        </AriaButton>
    );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`rounded-[12px] border border-card-border bg-panel ${className}`}>
            {(title || action) && (
                <div className="flex h-[56px] items-center gap-3 pr-[16px] pl-[16px]">
                    <h2 className="flex flex-1 items-center gap-2 text-[13px] font-semibold">{title}</h2>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

// A page's title across the top of the console, ruled off from the page below.
export function PageTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
    return (
        <div className="flex h-[64px] shrink-0 items-center gap-3 border-b border-rule pr-[32px] pb-[16px] pl-[32px]">
            <h1 className="flex-1 truncate text-[24px] font-semibold tracking-[-0.01em]">{children}</h1>
            {extra}
        </div>
    );
}

// The page under its title, inset like the title.
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`pt-[24px] pr-[32px] pb-12 pl-[32px] ${className}`}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange, label, className = "mb-[23px]" }: { tabs: [T, string][]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
    return (
        <div role="tablist" aria-label={label} className={`flex gap-[5px] ${className}`}>
            {tabs.map(([id, text]) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={value === id}
                    onClick={() => onChange(id)}
                    className={`h-[25px] rounded-[5px] px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${value === id ? "bg-field font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
                >
                    {text}
                </button>
            ))}
        </div>
    );
}

export function SearchField({ value, onChange, placeholder, className = "h-[24px] w-[249px] gap-[6px] px-[6px]" }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
    return (
        <label className={`flex shrink-0 items-center rounded-[5px] bg-field text-ink-muted focus-within:ring-1 focus-within:ring-brand-500 ${className}`}>
            <SearchSm className="size-3.5 shrink-0" />
            <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="w-full min-w-0 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
        </label>
    );
}

// "Seat type: All seat types ⌄": a filter button that names what it filters, with the app's dark menu.
export function FilterMenu<T extends string>({ label, value, options, onChange, bare }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; bare?: boolean }) {
    const current = options.find(([id]) => id === value)?.[1] ?? "";
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label={label} className="flex h-[24px] items-center gap-1 rounded-[5px] border border-panel-border px-2 text-[12px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                {!bare && <span className="text-ink-muted">{label}:</span>} {current}
                <ChevronDown className="ml-0.5 size-2.5 text-ink" />
            </AriaButton>
            <AriaPopover placement="bottom start" offset={4} className="outline-none">
                <div className="min-w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl">
                    <AriaMenu aria-label={label} className="outline-none" onAction={(k) => onChange(String(k) as T)}>
                        {options.map(([id, text]) => (
                            <AriaMenuItem key={id} id={id} textValue={text} className="flex h-7 cursor-default items-center gap-2 rounded-md pr-3 pl-1.5 text-[12px] outline-none data-[focused]:bg-brand-500">
                                <span className="flex w-3 justify-center">{id === value && <Check className="size-3" />}</span>
                                {text}
                            </AriaMenuItem>
                        ))}
                    </AriaMenu>
                </div>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={(e) => (e.stopPropagation(), onChange(!checked))}
            className={`relative h-[18px] w-8 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${checked ? "bg-brand-500" : "bg-ink-subtle/50"}`}
        >
            <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-[left] ${checked ? "left-[16px]" : "left-[2px]"}`} />
        </button>
    );
}

export function Banner({ children, onDismiss, tone = "info" }: { children: ReactNode; onDismiss?: () => void; tone?: "info" | "brand" }) {
    return (
        <div className={`flex items-start gap-2.5 rounded-[4px] px-3 py-[11px] text-[12px] ${tone === "brand" ? "bg-brand-500 text-white" : "bg-brand-100 text-ink"}`}>
            <InfoCircle className={`mt-px size-4 shrink-0 ${tone === "brand" ? "text-white" : "text-ink"}`} />
            <div className="min-w-0 flex-1 leading-[18px]">{children}</div>
            {onDismiss && (
                <AriaButton aria-label="Dismiss" onPress={onDismiss} className={`rounded p-0.5 outline-none ${tone === "brand" ? "hover:bg-white/15" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                    <X className="size-3.5" />
                </AriaButton>
            )}
        </div>
    );
}

export function RoleBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "warn" }) {
    const look = tone === "brand" ? "bg-field text-ink" : tone === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-field text-ink";
    return <span className={`rounded-[3px] px-1 py-px text-[10px] font-medium ${look}`}>{children}</span>;
}

export function Dialog({ title, description, onClose, children, footer, width = 440 }: { title: string; description?: ReactNode; onClose: () => void; children?: ReactNode; footer?: ReactNode; width?: number }) {
    return (
        <AriaModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[12vh] pb-8">
            <AriaModal style={{ width }} className="max-w-full rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label={title} className="outline-none">
                    <div className="flex items-start gap-3 px-5 pt-4">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-[14px] font-semibold">{title}</h2>
                            {description && <p className="mt-1 text-[12px] leading-[18px] text-ink-muted">{description}</p>}
                        </div>
                        <AriaButton aria-label="Close" onPress={onClose} className="rounded p-1 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <X className="size-4" />
                        </AriaButton>
                    </div>
                    {children && <div className="px-5 pt-4 text-[12px]">{children}</div>}
                    <div className="flex justify-end gap-2 px-5 pt-5 pb-4">{footer ?? <Button onPress={onClose}>Close</Button>}</div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="block text-[11.5px] font-medium">{label}</span>
            {children}
            {hint && <span className="block text-[11px] text-ink-muted">{hint}</span>}
        </label>
    );
}

export function ErrorText({ children }: { children: ReactNode }) {
    return children ? <p className="mt-3 text-[11.5px] text-red-500">{children}</p> : null;
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
    return (
        <div className="h-1 w-full overflow-hidden rounded-full bg-field" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
            <div className={`h-full min-w-[4px] rounded-full ${pct >= 100 ? "bg-amber-500" : "bg-[#5a8fd8]"}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
    // A quiet line of grey text in the middle of an empty table, with any detail under it.
    return (
        <div className="flex flex-col items-center justify-center px-6 py-[128px] text-center">
            <div className="text-[12px] text-ink-muted">{title}</div>
            {children && <div className="mt-1.5 max-w-sm text-[12px] text-ink-muted">{children}</div>}
        </div>
    );
}

// Table header and rows sharing one grid template.
export function TableHead({ cols, children, inset = "px-2", border = "border-y" }: { cols: string; children: ReactNode; inset?: string; border?: string }) {
    return (
        <div className={`grid h-[50px] items-center gap-x-[9px] border-rule text-[12px] font-semibold text-ink ${border} ${inset}`} style={{ gridTemplateColumns: cols }}>
            {children}
        </div>
    );
}

export function TableRow({ cols, children, onClick, label, inset = "px-2" }: { cols: string; children: ReactNode; onClick?: () => void; label?: string; inset?: string }) {
    return (
        <div
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={label}
            onClick={onClick}
            onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
            className={`group/row grid min-h-[48px] items-center gap-x-[9px] border-b border-rule text-[12px] ${inset} ${onClick ? "cursor-default outline-none hover:bg-panel-hover/60 focus-visible:bg-panel-hover" : ""}`}
            style={{ gridTemplateColumns: cols }}
        >
            {children}
        </div>
    );
}


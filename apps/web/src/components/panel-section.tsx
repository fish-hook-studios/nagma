import type { ReactNode } from "react";

// The design panel's section rhythm, shared by every section in it: a 40pt title row, control rows
// of 24pt controls on a 32pt pitch (8pt between them), 4pt above the first row and 16pt below the
// last one (the row's own 4pt plus 12pt of padding), then a 1pt rule. A section with no rows is just
// its title row and rule (41pt), and its title is muted, as in the reference.
//
// The columns: 16pt in from the panel's left rule (15 inside it) and 8pt in from its right edge, so
// a row of two 88pt fields and a 24pt button is 88 + 8 + 88 + 8 + 24 = 216.

export const SECTION = "border-b border-section-rule pr-2 pl-[15px]";
export const SECTION_TITLE = "flex h-10 items-center justify-between gap-1";
export const SECTION_BODY = "space-y-2 pt-1 pb-4";
// Two 88pt fields and a trailing 24pt button column.
export const ROW = "grid grid-cols-[88px_88px_24px] items-center gap-2";
// Two 88pt fields with nothing after them.
export const PAIR = "grid grid-cols-[88px_88px] items-center gap-2";

export function Section({ title, action, children, muted, className = "", label }: { title: ReactNode; action?: ReactNode; children?: ReactNode; muted?: boolean; className?: string; label?: string }) {
    // A body whose children all render nothing collapses (:empty), and the title goes muted with it.
    const tone = muted === undefined ? "[&:has(>[data-section-body]:empty)>div>h3]:text-ink-muted" : muted ? "[&>div>h3]:text-ink-muted" : "";
    return (
        <section aria-label={label} className={`${SECTION} ${tone} ${className}`}>
            <div className={SECTION_TITLE}>
                <h3 className="min-w-0 truncate font-semibold">{title}</h3>
                {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
            </div>
            <div data-section-body="" className={`${SECTION_BODY} empty:hidden`}>
                {children}
            </div>
        </section>
    );
}

// The selection header ("Frame ⌄", "Text"…): one 47pt row and its rule.
export function HeaderSection({ title, action }: { title: ReactNode; action?: ReactNode }) {
    return (
        <section className={SECTION}>
            <div className="flex h-[47px] items-center justify-between gap-1">
                <h3 className="min-w-0 font-semibold">{title}</h3>
                {action && <div className="flex items-center">{action}</div>}
            </div>
        </section>
    );
}

// Buttons joined into one 24pt control (the align groups, rotate and flip, text resizing): one
// field-coloured strip with 1pt panel-coloured seams between the buttons.
export const JOINED = "flex h-6 min-w-0 gap-px overflow-hidden rounded-md";
export const JOINED_BUTTON =
    "flex h-6 min-w-0 flex-1 items-center justify-center bg-field text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:text-ink-subtle/60 aria-pressed:bg-panel-hover aria-pressed:text-ink";
// A 24pt icon button in the trailing column or a title row.
export const ICON_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500";

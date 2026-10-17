import { AlertTriangle, ChevronDown, SearchSm } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { fontStatus } from "../engine/fonts";
import { FIELD, WEIGHTS, styleLabel, useFamilyStyles, useFonts } from "./type-shared";
import { editor } from "../engine/store";
import { FONT_FAMILIES, ensureFont } from "../engine/text";
import { Select } from "./select";

// Small controls shared by Typography, Type settings and the text style editor.

export function Segmented<T extends string>({ value, options, onChange }: { value: T | null; options: { id: T; label: string; icon?: React.FC<{ className?: string }> }[]; onChange: (value: T) => void }) {
    return (
        // One 24pt field-coloured strip; the chosen segment is outlined on the panel colour.
        <div className="flex h-6 min-w-0 rounded-md bg-field">
            {options.map(({ id, label, icon: Icon }) => (
                <button
                    key={id}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={value === id}
                    onClick={() => onChange(id)}
                    className={`flex h-6 min-w-0 flex-1 items-center justify-center rounded-md border px-1 text-[10px] font-medium ${value === id ? "border-panel-border bg-panel text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                    {Icon ? <Icon className="size-3.5" /> : label}
                </button>
            ))}
        </div>
    );
}

// The weight and style menu: the font's own named styles when they are known, else every weight
// with italics as entries of their own.
export function WeightSelect({ weight, italic, onChange, mixed, className, family }: { weight: number | null; italic: boolean | null; mixed?: boolean; onChange: (weight: number, italic: boolean) => void; className?: string; family?: string | null }) {
    const key = weight === null || italic === null || mixed ? "" : `${weight}${italic ? "i" : ""}`;
    const styles = useFamilyStyles(family ?? null);
    const list = styles?.length ? styles.map((s) => [s.weight, s.italic, s.label] as const) : WEIGHTS.flatMap(([value, label]) => [[value, false, label] as const, [value, true, value === 400 ? "Italic" : `${label} Italic`] as const]);
    const known = list.some(([w, i]) => w === weight && i === Boolean(italic));
    return (
        <Select
            aria-label="Font style"
            value={key}
            onChange={(event) => {
                const v = event.target.value;
                if (v) onChange(Number.parseInt(v, 10), v.endsWith("i"));
            }}
            className={className ?? `${FIELD} w-full`}
        >
            {key === "" && <option value="">Mixed</option>}
            {weight !== null && !known && key !== "" && <option value={key}>{styleLabel(weight, Boolean(italic))}</option>}
            {list.map(([value, it, label]) => (
                <option key={`${value}${it ? "i" : ""}`} value={`${value}${it ? "i" : ""}`}>
                    {label}
                </option>
            ))}
        </Select>
    );
}

// The font family picker: a searchable list with each family set in itself. A family that can't
// be loaded shows a warning, like the reference's missing fonts.
export function FontPicker({ family, onPick, className, placement = "left top" }: { family: string | null; onPick: (name: string) => void; className?: string; placement?: "left top" | "bottom start" | "bottom" }) {
    useFonts();
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const list = useMemo(() => FONT_FAMILIES.filter((name) => !q || name.toLowerCase().includes(q)), [q]);
    const custom = q && !FONT_FAMILIES.some((n) => n.toLowerCase() === q) ? query.trim() : null;
    const missing = family !== null && fontStatus(family) === "missing";
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Font family" className={`${className ?? "h-6 w-full rounded-md px-2"} flex items-center justify-between gap-1 border bg-field text-left text-ink outline-none hover:border-panel-border ${missing ? "border-amber-500/60" : "border-transparent"}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                    {missing && <AlertTriangle className="size-3.5 shrink-0 text-amber-500" aria-label="Missing font" />}
                    <span className="truncate">{family ?? "Mixed"}</span>
                </span>
                <ChevronDown className="size-3 shrink-0 text-ink-subtle" />
            </AriaButton>
            <AriaPopover placement={placement} offset={8} className="w-64 rounded-lg border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label="Fonts">
                    {({ close }) => (
                        <div>
                            <label className="flex h-9 items-center gap-2 border-b border-panel-border px-3 text-ink-muted">
                                <SearchSm className="size-3.5" />
                                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fonts" aria-label="Search fonts" onKeyDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
                            </label>
                            <div className="max-h-72 overflow-y-auto p-1">
                                {custom && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onPick(custom);
                                            close();
                                        }}
                                        className="flex h-8 w-full items-center rounded-md px-2 text-left text-ink-muted hover:bg-panel-hover"
                                    >
                                        Use "{custom}"
                                    </button>
                                )}
                                {list.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => {
                                            onPick(name);
                                            close();
                                        }}
                                        onMouseEnter={() => ensureFont(name, () => editor.refreshText())}
                                        className={`flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-panel-hover ${family === name ? "text-brand-500" : ""}`}
                                        style={{ fontFamily: `"${name}", system-ui, sans-serif` }}
                                    >
                                        <span className="truncate">{name}</span>
                                        {family === name && <span className="text-brand-500">✓</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? "bg-brand-500" : "bg-field"}`}
        >
            <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${checked ? "left-3.5" : "left-0.5"}`} />
        </button>
    );
}

import { AlignBottom01, AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignTopArrow01, AlignVerticalCenter01, ChevronDown, ChevronLeft, ChevronRight, Dotpoints01, Strikethrough01, Underline01, XClose } from "@untitledui/icons";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { applyCommand } from "../engine/commands";
import { familyAxes } from "../engine/fonts";
import { fontFeatures, fontVariation } from "../engine/font-outlines";
import type { FontAxis, FontInstance } from "../engine/font-reader";
import { axisStops, parseTypedUnit, snapToStop } from "../engine/type-units";
import { ALL_OPENTYPE_TAGS, featureName } from "../engine/opentype";
import { MIXED, type Mixed, paragraphStyle } from "../engine/rich-text";
import { editor, useEditor } from "../engine/store";
import { stylesOf } from "../engine/styles";
import { ensureFont } from "../engine/text";
import { useLinkRequests } from "../engine/text-link";
import { applyCharStyle, selectedParagraphs, sharedTextValue, styleCommands, updateParagraphs, useTextSession } from "../engine/text-session";
import type { NagmaDocument, NodePatch, SceneNode, SpanStyle, TextDecorationStyle } from "../engine/types";
import { screens } from "../engine/prototype";
import { ColorSwatch } from "./color-picker";
import { MenuRow } from "./left-sidebar";
import { MissingFontsNotice } from "./missing-fonts";
import { NumberField } from "./number-field";
import { TextStyleEditorHost, TextStylePicker, TextStyleRow } from "./text-styles";
import { FontPicker, Segmented, Toggle, WeightSelect } from "./type-controls";
import { FIELD, SIZE_PRESETS, useFonts } from "./type-shared";
import { Bindable, VarButton } from "./variable-picker";
import { Select } from "./select";
import { PAIR, ROW, Section } from "./panel-section";

// The reference's Typography section: text style, family, weight, size, line height, letter spacing,
// alignment and the Type settings popover. While text is being edited, character settings read and
// change just the selected range (Mixed when it varies); otherwise the whole layer.

const value = <T,>(v: T | Mixed): T | null => (v === MIXED ? null : v);

function shared<T>(nodes: SceneNode[], pick: (node: SceneNode) => T): T | null {
    const first = nodes[0];
    if (!first) return null;
    const v = pick(first);
    return nodes.every((node) => pick(node) === v) ? v : null;
}

// Paragraph and layout settings that belong to the whole layer (and its text style, if any).
function updateLayer(nodes: SceneNode[], patch: (node: SceneNode) => NodePatch, detach = false) {
    editor.execute({ type: "batch", commands: nodes.map((node) => ({ type: "node.update" as const, id: node.id, patch: { ...patch(node), ...(detach && node.textStyleId ? { textStyleId: null } : {}) } })) });
}

// A number field for a character setting: typed edits and scrubbing (one undo step).
function useCharField(nodes: SceneNode[], read: number | null, toPatch: (v: number, node: SceneNode) => SpanStyle) {
    const base = useRef<NagmaDocument | null>(null);
    const build = (doc: NagmaDocument, v: number) => ({
        type: "batch" as const,
        commands: nodes.flatMap((n) => {
            const node = doc.nodes[n.id];
            return node ? styleCommands([node], toPatch(v, node)) : [];
        }),
    });
    return {
        value: read === null ? null : Math.round(read * 100) / 100,
        onCommit: (v: number) => {
            for (const n of nodes) applyCharStyle([n], toPatch(v, n), { detachStyle: true });
            if (nodes.length > 1) for (let i = 1; i < nodes.length; i++) editor.mergeLast();
        },
        onScrub: (v: number) => {
            base.current ??= editor.get().doc;
            editor.preview(applyCommand(base.current, build(base.current, v)));
        },
        onScrubEnd: (v: number) => {
            const start = base.current ?? editor.get().doc;
            base.current = null;
            editor.execute(build(start, v), start);
        },
    };
}

export function TypographySection({ nodes }: { nodes: SceneNode[] }) {
    useTextSession();
    useFonts();
    const textStyles = useEditor((s) => stylesOf(s.doc).texts);
    // The units are remembered across sessions (a preference).
    const lineUnit = useEditor((s) => s.prefs.lineHeightUnit);
    const trackUnit = useEditor((s) => s.prefs.letterSpacingUnit);
    const setLineUnit = (lineHeightUnit: "%" | "px") => editor.setPrefs({ lineHeightUnit });
    const setTrackUnit = (letterSpacingUnit: "%" | "px") => editor.setPrefs({ letterSpacingUnit });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<"basics" | "details" | "variable">("basics");
    const linkRequests = useLinkRequests();
    const seen = useRef(linkRequests);
    // ⌘K opens Type settings at the link field.
    useEffect(() => {
        if (linkRequests === seen.current) return;
        seen.current = linkRequests;
        setSettingsTab("details");
        setSettingsOpen(true);
    }, [linkRequests]);

    const set = (patch: SpanStyle) => applyCharStyle(nodes, patch, { detachStyle: true });
    const family = value(sharedTextValue(nodes, "fontFamily"));
    const weight = value(sharedTextValue(nodes, "fontWeight"));
    const italic = value(sharedTextValue(nodes, "italic"));
    const size = value(sharedTextValue(nodes, "fontSize"));
    const lh = sharedTextValue(nodes, "lineHeight");
    const tracking = value(sharedTextValue(nodes, "letterSpacing"));
    const fontSize = useCharField(nodes, size, (v) => ({ fontSize: Math.max(1, v) }));
    const lineHeight = useCharField(nodes, lh === MIXED || lh === null ? null : lineUnit === "%" ? Math.round(lh * 10000) / 100 : size === null ? null : Math.round(lh * size * 100) / 100, (v, node) => ({
        lineHeight: Math.max(0.1, lineUnit === "%" ? v / 100 : v / (value(sharedTextValue([node], "fontSize")) ?? node.fontSize ?? 12)),
    }));
    const letterSpacing = useCharField(nodes, tracking === null ? null : trackUnit === "%" ? tracking : size === null ? null : Math.round((tracking / 100) * size * 10) / 10, (v, node) => ({
        letterSpacing: trackUnit === "%" ? v : (v / (value(sharedTextValue([node], "fontSize")) ?? node.fontSize ?? 12)) * 100,
    }));
    const styleId = value(sharedTextValue(nodes, "textStyleId"));
    const styled = styleId ? textStyles.find((t) => t.id === styleId) : undefined;
    const autoLine = lh === null;

    return (
        <Section
            title="Typography"
            action={
                <>
                    <VarButton nodes={nodes} field="text" label="Apply variable to text content" />
                    <TextStylePicker nodes={nodes} />
                </>
            }
        >
                {styled ? (
                    <TextStyleRow nodes={nodes} style={styled} />
                ) : (
                    <>
                        <MissingFontsNotice nodes={nodes} />
                        <div className={ROW}>
                            <div className="col-span-2 min-w-0">
                                <FontPicker
                                    family={family}
                                    onPick={(next) => {
                                        ensureFont(next, () => editor.refreshText());
                                        set({ fontFamily: next });
                                    }}
                                />
                            </div>
                        </div>
                        <div className={PAIR}>
                            <div className="flex min-w-0 items-center">
                                <WeightSelect
                                    weight={weight}
                                    italic={italic}
                                    family={family}
                                    onChange={(fontWeight, it) => {
                                        // A named weight replaces a weight set on the variable axis.
                                        const axes = value(sharedTextValue(nodes, "fontVariations"));
                                        const { wght: _w, ...rest } = axes ?? {};
                                        set({ fontWeight, italic: it, ...(axes && "wght" in axes ? { fontVariations: rest } : {}) });
                                    }}
                                />
                                <VarButton nodes={nodes} field="fontStyle" label="Apply variable to font style" />
                            </div>
                            <div className="flex min-w-0 items-center">
                                <Bindable nodes={nodes} field="fontSize" label="font size">
                                    <NumberField label="" title="Font size" min={1} {...fontSize} />
                                </Bindable>
                                <AriaMenuTrigger>
                                    <AriaButton aria-label="Font size presets" className="flex h-6 w-4 shrink-0 items-center justify-center rounded text-ink-subtle outline-none hover:text-ink">
                                        <ChevronDown className="size-3" />
                                    </AriaButton>
                                    <AriaPopover placement="bottom end" className="max-h-72 w-24 overflow-y-auto rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                                        <AriaMenu className="outline-none" onAction={(k) => set({ fontSize: Number(k) })}>
                                            {SIZE_PRESETS.map((n) => (
                                                <MenuRow key={n} id={String(n)} label={String(n)} checked={size === n} />
                                            ))}
                                        </AriaMenu>
                                    </AriaPopover>
                                </AriaMenuTrigger>
                            </div>
                        </div>
                        <div className={PAIR}>
                            <Bindable nodes={nodes} field="lineHeight" label="line height">
                                <NumberField
                                    label="Line height"
                                    name="Line height"
                                    icon={<LineHeightIcon className="size-3.5" />}
                                    title="Line height"
                                    min={0}
                                    unit={lineUnit === "%" ? "%" : ""}
                                    nullLabel={lh === MIXED ? "Mixed" : "Auto"}
                                    {...lineHeight}
                                    value={autoLine ? null : lineHeight.value}
                                    onText={(t) => {
                                        const typed = parseTypedUnit(t);
                                        if (!typed) return false;
                                        if (typed.kind === "auto") set({ lineHeight: null });
                                        else {
                                            const unit = typed.unit ?? lineUnit;
                                            if (typed.unit && typed.unit !== lineUnit) setLineUnit(typed.unit);
                                            for (const n of nodes) applyCharStyle([n], { lineHeight: Math.max(0.01, unit === "%" ? typed.value / 100 : typed.value / (value(sharedTextValue([n], "fontSize")) ?? n.fontSize ?? 12)) }, { detachStyle: true });
                                            if (nodes.length > 1) for (let i = 1; i < nodes.length; i++) editor.mergeLast();
                                        }
                                        return true;
                                    }}
                                />
                            </Bindable>
                            <Bindable nodes={nodes} field="letterSpacing" label="letter spacing">
                                <NumberField
                                    label="Letter spacing"
                                    name="Letter spacing"
                                    icon={<LetterSpacingIcon className="size-3.5" />}
                                    title="Letter spacing"
                                    unit={trackUnit}
                                    {...letterSpacing}
                                    onText={(t) => {
                                        const typed = parseTypedUnit(t);
                                        if (!typed || typed.kind === "auto") return false;
                                        const unit = typed.unit ?? trackUnit;
                                        if (typed.unit && typed.unit !== trackUnit) setTrackUnit(typed.unit);
                                        for (const n of nodes) applyCharStyle([n], { letterSpacing: unit === "%" ? typed.value : (typed.value / (value(sharedTextValue([n], "fontSize")) ?? n.fontSize ?? 12)) * 100 }, { detachStyle: true });
                                        if (nodes.length > 1) for (let i = 1; i < nodes.length; i++) editor.mergeLast();
                                        return true;
                                    }}
                                />
                            </Bindable>
                        </div>
                    </>
                )}
                <div className={ROW}>
                    <Segmented
                        value={shared(nodes, (node) => node.textAlign ?? "left")}
                        options={[
                            { id: "left", label: "Align left", icon: AlignLeft },
                            { id: "center", label: "Align centre", icon: AlignCenter },
                            { id: "right", label: "Align right", icon: AlignRight },
                        ]}
                        onChange={(textAlign) => updateLayer(nodes, () => ({ textAlign }))}
                    />
                    <Segmented
                        value={shared(nodes, (node) => node.textAlignV ?? "top")}
                        options={[
                            { id: "top", label: "Align top", icon: AlignTopArrow01 },
                            { id: "middle", label: "Align middle", icon: AlignVerticalCenter01 },
                            { id: "bottom", label: "Align bottom", icon: AlignBottom01 },
                        ]}
                        onChange={(textAlignV) => updateLayer(nodes, () => ({ textAlignV }))}
                    />
                    <AriaDialogTrigger isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
                        <AriaButton aria-label="Type settings" className={`flex size-6 items-center justify-center rounded-md outline-none ${settingsOpen ? "bg-brand-100 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                            <TypeSettingsIcon className="size-4" />
                        </AriaButton>
                        <AriaPopover placement="left top" offset={12} className="w-60 rounded-xl border border-panel-border bg-panel-raised text-ink shadow-xl outline-none">
                            <AriaDialog className="outline-none" aria-label="Type settings">
                                <TypeSettings nodes={nodes} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsOpen(false)} focusLink={linkRequests > 0 && settingsTab === "details"} />
                            </AriaDialog>
                        </AriaPopover>
                    </AriaDialogTrigger>
                </div>
                <TextStyleEditorHost />
        </Section>
    );
}

// OpenType features offered in Details (the font's own list decides which show, when known).
const LETTER_FEATURES: [string, string][] = [
    ["liga", "Common ligatures"],
    ["calt", "Contextual alternates"],
    ["dlig", "Discretionary ligatures"],
    ["case", "Case-sensitive forms"],
    ["cpsp", "Capital spacing"],
    ["smcp", "Small caps"],
    ["c2sc", "Capitals to small caps"],
];
const DEFAULT_ON = new Set(["liga", "calt", "clig", "kern"]);
const AXIS_NAMES: Record<string, string> = { wght: "Weight", wdth: "Width", opsz: "Optical size", slnt: "Slant", ital: "Italic", GRAD: "Grade" };

// Tags Details already has a control for.
const SHOWN_FEATURES = new Set(["tnum", "pnum", "lnum", "onum", "sups", "subs", "frac", "zero", ...LETTER_FEATURES.map(([t]) => t)]);

// Every other OpenType feature: the font's own list when it is known, otherwise all registered tags.
function MoreFeatures({ supported, on, onChange, row }: { supported: Set<string> | null; on: (tag: string) => boolean; onChange: (tag: string, enabled: boolean) => void; row: (label: string, control: React.ReactNode) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    // With the font's list known, its stylistic sets already have rows of their own above.
    const tags = supported ? [...supported].sort().filter((t) => !SHOWN_FEATURES.has(t) && !/^ss\d\d$/.test(t)) : ALL_OPENTYPE_TAGS.filter((t) => !SHOWN_FEATURES.has(t));
    if (!tags.length) return null;
    const q = query.trim().toLowerCase();
    const shown = q ? tags.filter((t) => t.includes(q) || featureName(t).toLowerCase().includes(q)) : tags;
    return (
        <>
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-6 w-full items-center gap-1 pt-1 font-medium text-ink">
                <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} />
                More features ({tags.length})
            </button>
            {open && (
                <>
                    <input aria-label="Search features" placeholder="Search features" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${FIELD} w-full px-2`} />
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                        {shown.map((tag) => (
                            <Fragment key={tag}>{row(`${featureName(tag)} (${tag})`, <Toggle label={featureName(tag)} checked={on(tag)} onChange={(c) => onChange(tag, c)} />)}</Fragment>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}


// Icons drawn to match the reference's Typography section.
function LineHeightIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 2.5h11M2.5 13.5h11" />
            <path d="m5.2 11.5 2.8-7 2.8 7M6.2 9.2h3.6" />
        </svg>
    );
}

function LetterSpacingIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 2.5v11M14 2.5v11" />
            <path d="m5.4 11.5 2.6-7 2.6 7M6.4 9.2h3.2" />
        </svg>
    );
}

function TypeSettingsIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 2.5v3.2M5 9.3v4.2M11 2.5v5.2M11 11.3v2.2" />
            <circle cx="5" cy="7.5" r="1.8" />
            <circle cx="11" cy="9.5" r="1.8" />
        </svg>
    );
}

function NoneIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 8h9" />
        </svg>
    );
}

function CheckIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3.5 8.5 3 3 6-7" />
        </svg>
    );
}

function NumberedListIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
            <path d="M7 4h7M7 8h7M7 12h7" />
            <path d="M2.6 2.9 3.6 2.4v3.2M2.4 9.4c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .8-1.4 1.4-2.1 2.4h2.2" strokeLinejoin="round" strokeWidth="1" />
        </svg>
    );
}

function TrimIcon({ className, cap }: { className?: string; cap: boolean }) {
    // "Ag" between two rules: the rules hug the cap height and baseline when trimmed.
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <path d={cap ? "M1.5 3.5h13M1.5 11.5h13" : "M1.5 1.5h13M1.5 14.5h13"} strokeLinecap="round" />
            <text x="8" y="11.2" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="currentColor" stroke="none" fontFamily="inherit">
                Ag
            </text>
        </svg>
    );
}

function TextGlyph({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <span className="text-[11px] leading-none font-medium" style={style}>
            {children}
        </span>
    );
}

type SegOption<T extends string> = { id: T; label: string; icon?: React.ReactNode };

// The reference's compact segmented control: the chosen option sits in its own outlined box.
function Seg<T extends string>({ value, options, onChange, label }: { value: T | null; options: SegOption<T>[]; onChange: (value: T) => void; label: string }) {
    return (
        <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-md bg-field">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    role="radio"
                    title={o.label}
                    aria-label={o.label}
                    aria-checked={value === o.id}
                    onClick={() => onChange(o.id)}
                    className={`flex h-6 min-w-6 items-center justify-center rounded-md border px-1 ${value === o.id ? "border-panel-border bg-panel text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                    {o.icon ?? <TextGlyph>{o.label}</TextGlyph>}
                </button>
            ))}
        </div>
    );
}

// An on/off setting shown as a dash and a check mark, the way the reference's Details tab does.
function Check({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
    return (
        <Seg
            label={label}
            value={checked ? "on" : "off"}
            options={[
                { id: "off", label: "Off", icon: <NoneIcon className="size-3.5" /> },
                { id: "on", label: "On", icon: <CheckIcon className="size-3.5" /> },
            ]}
            onChange={(v) => onChange(v === "on")}
        />
    );
}

const CASE_OPTIONS: SegOption<NonNullable<SpanStyle["textCase"]>>[] = [
    { id: "none", label: "As typed", icon: <NoneIcon className="size-3.5" /> },
    { id: "upper", label: "Uppercase", icon: <TextGlyph>AG</TextGlyph> },
    { id: "lower", label: "Lowercase", icon: <TextGlyph>ag</TextGlyph> },
    { id: "title", label: "Title case", icon: <TextGlyph>Ag</TextGlyph> },
    { id: "small-caps", label: "Small caps", icon: <TextGlyph style={{ fontVariant: "small-caps" }}>Ag</TextGlyph> },
];

// The text the Preview shows: the layer's own first line, or "Preview" for an empty layer.
function previewText(nodes: SceneNode[]): string {
    const text = nodes[0]?.text ?? "";
    const line = text.split("\n").find((l) => l.trim()) ?? "";
    return line.trim().slice(0, 60) || "Preview";
}

const AXIS_ORDER = ["wght", "wdth", "slnt", "ital", "opsz", "GRAD"];

// The reference's Type settings popover: Basics, Details and (variable fonts) Variable tabs with a
// close button, a Preview of the selected text in its font, then the tab's rows.
function TypeSettings({ nodes, tab, onTab, onClose, focusLink }: { nodes: SceneNode[]; tab: "basics" | "details" | "variable"; onTab: (t: "basics" | "details" | "variable") => void; onClose: () => void; focusLink: boolean }) {
    useTextSession();
    useFonts();
    const first = nodes[0];
    const set = (patch: SpanStyle) => applyCharStyle(nodes, patch, { detachStyle: true });
    const family = value(sharedTextValue(nodes, "fontFamily")) ?? first?.fontFamily ?? "Inter";
    const features = value(sharedTextValue(nodes, "openType")) ?? {};
    const axesValues = value(sharedTextValue(nodes, "fontVariations")) ?? {};
    const weight = value(sharedTextValue(nodes, "fontWeight")) ?? 400;
    const size = value(sharedTextValue(nodes, "fontSize")) ?? 16;
    const metaAxes = familyAxes(family) ?? [];
    const [supported, setSupported] = useState<Set<string> | null>(null);
    const [variation, setVariation] = useState<{ axes: FontAxis[]; instances: FontInstance[] } | null>(null);
    const [decorationPage, setDecorationPage] = useState(false);
    const italic = value(sharedTextValue(nodes, "italic")) ?? false;
    useEffect(() => {
        let live = true;
        void fontFeatures(family, weight, italic).then((list) => live && setSupported(list ? new Set(list) : null));
        void fontVariation(family, weight, italic).then((v) => live && setVariation(v && v.axes.length ? v : null));
        return () => {
            live = false;
        };
    }, [family, weight, italic]);
    // The font's own axes (fvar) when its file could be read, else the family's published axes.
    // The font's own order is kept (as the reference lists them); published axes are sorted.
    const axes: { tag: string; min: number; max: number; def?: number; name?: string }[] = variation ? variation.axes : [...metaAxes].sort((a, b) => {
        const ia = AXIS_ORDER.indexOf(a.tag);
        const ib = AXIS_ORDER.indexOf(b.tag);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const on = (tag: string) => features[tag] ?? DEFAULT_ON.has(tag);
    const setFeature = (tag: string, enabled: boolean, off: string[] = []) => {
        const next = { ...features, [tag]: enabled };
        for (const t of off) next[t] = false;
        set({ openType: next });
    };
    const offered = (tag: string) => !supported || supported.has(tag);
    const decoration = value(sharedTextValue(nodes, "decoration"));
    const decorationStyle = value(sharedTextValue(nodes, "decorationStyle"));
    const decorationOffset = sharedTextValue(nodes, "decorationOffset");
    const decorationThickness = sharedTextValue(nodes, "decorationThickness");
    const decorationColor = sharedTextValue(nodes, "decorationColor");
    const skipInk = value(sharedTextValue(nodes, "decorationSkipInk"));
    const textCase = value(sharedTextValue(nodes, "textCase"));
    const link = value(sharedTextValue(nodes, "hyperlink"));
    const linkKind: "url" | "node" = link?.startsWith("node:") ? "node" : "url";
    const doc = useEditor((s) => s.doc);
    const screensList = useMemo(() => screens(doc), [doc]);
    // "Auto" fields: a number, or empty / "auto" for the font's own value.
    const autoField = (label: string, title: string, v: number | null | Mixed, put: (n: number | null) => void) => (
        <NumberField
            label={label}
            title={title}
            min={0}
            step={0.5}
            value={v === MIXED ? null : v}
            nullLabel={v === MIXED ? "Mixed" : "Auto"}
            onText={(t) => {
                if (t.trim() !== "" && !/^auto$/i.test(t.trim())) return false;
                put(null);
                return true;
            }}
            onCommit={(n) => put(n)}
        />
    );
    const truncate = nodes.every((n) => n.truncate !== false && Boolean(n.maxLines));
    const listKind = shared(nodes, (n) => {
        const [a, b] = selectedParagraphs(n);
        const kinds = new Set<string>();
        for (let i = a; i <= b; i++) kinds.add(paragraphStyle(n, i).list ?? "");
        return kinds.size === 1 ? [...kinds][0] ?? "" : "mixed";
    });
    // The reference's rhythm: 32pt rows (24pt controls), 16pt side padding, a rule with 12pt above
    // and 8pt below between groups.
    const row = (label: string, control: React.ReactNode) => (
        <div className="flex min-h-8 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-ink-muted">{label}</span>
            {control}
        </div>
    );
    const fieldBox = (control: React.ReactNode) => <div className="w-[88px] shrink-0">{control}</div>;
    const narrowBox = (control: React.ReactNode) => <div className="w-[71.5px] shrink-0">{control}</div>;
    const heading = (text: string) => <div className="pt-1 pb-0.5 font-semibold text-ink">{text}</div>;
    const divider = <div className="-mx-[15px] mt-3 mb-2 h-px bg-panel-border" />;
    const linkRef = useRef<HTMLInputElement>(null);
    const slideBase = useRef<NagmaDocument | null>(null);
    const slideValue = useRef<number | null>(null);
    useEffect(() => {
        if (focusLink) linkRef.current?.focus();
    }, [focusLink]);
    const tabs: ("basics" | "details" | "variable")[] = axes.length ? ["basics", "details", "variable"] : ["basics", "details"];
    const shownTab = tabs.includes(tab) ? tab : "basics";
    const setCase = (c: NonNullable<SpanStyle["textCase"]>) => set({ textCase: c });
    return (
        <div onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex h-10 items-center gap-0.5 border-b border-panel-border pr-2 pl-2">
                {tabs.map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={shownTab === t} onClick={() => onTab(t)} className={`h-6 rounded-md px-2 font-semibold ${shownTab === t ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {t === "basics" ? "Basics" : t === "details" ? "Details" : "Variable"}
                    </button>
                ))}
                <button type="button" aria-label="Close" onClick={onClose} className="ml-auto flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <XClose className="size-4" />
                </button>
            </div>
            <div className="px-[15px] pt-4">
                <div className="flex h-[120px] w-[207.5px] max-w-full items-center overflow-hidden rounded-[5px] bg-field px-4">
                    <div
                        aria-label="Preview"
                        className="w-full truncate text-ink"
                        style={{
                            fontFamily: `"${family}", system-ui, sans-serif`,
                            fontSize: Math.max(12, Math.min(28, size)),
                            fontWeight: axesValues.wght ?? weight,
                            fontStyle: italic ? "italic" : "normal",
                            textAlign: (shared(nodes, (n) => n.textAlign ?? "left") ?? "left") as React.CSSProperties["textAlign"],
                            textDecoration: decoration === "underline" ? "underline" : decoration === "strikethrough" ? "line-through" : "none",
                            textTransform: textCase === "upper" ? "uppercase" : textCase === "lower" ? "lowercase" : textCase === "title" ? "capitalize" : "none",
                            fontVariant: textCase === "small-caps" || textCase === "small-caps-forced" ? "small-caps" : "normal",
                            fontFeatureSettings: Object.entries(features).map(([t, v]) => `"${t}" ${v ? 1 : 0}`).join(", ") || "normal",
                            fontVariationSettings: Object.entries(axesValues).map(([t, v]) => `"${t}" ${v}`).join(", ") || "normal",
                        }}
                    >
                        {previewText(nodes)}
                    </div>
                </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-[15px] pt-2 pb-11">
                {shownTab === "basics" && decorationPage && (
                    <>
                        <button type="button" onClick={() => setDecorationPage(false)} className="-ml-1 flex h-7 items-center gap-1 rounded-md px-1 font-semibold text-ink hover:bg-panel-hover">
                            <ChevronLeft className="size-3.5" /> Decoration
                        </button>
                        {row(
                            "Decoration",
                            <Seg
                                label="Decoration"
                                value={decoration}
                                options={[
                                    { id: "none", label: "None", icon: <NoneIcon className="size-3.5" /> },
                                    { id: "underline", label: "Underline", icon: <Underline01 className="size-3.5" /> },
                                    { id: "strikethrough", label: "Strikethrough", icon: <Strikethrough01 className="size-3.5" /> },
                                ]}
                                onChange={(d) => set({ decoration: d })}
                            />,
                        )}
                        {decoration !== "none" && (
                            <>
                                {row(
                                    "Style",
                                    fieldBox(
                                        <Select aria-label="Decoration style" value={decorationStyle ?? ""} onChange={(e) => e.target.value && set({ decorationStyle: e.target.value as TextDecorationStyle })} className={`${FIELD} w-full`}>
                                            {decorationStyle === null && <option value="">Mixed</option>}
                                            <option value="solid">Solid</option>
                                            <option value="double">Double</option>
                                            <option value="dotted">Dotted</option>
                                            <option value="dashed">Dashed</option>
                                            <option value="wavy">Wavy</option>
                                        </Select>,
                                    ),
                                )}
                                {decoration === "underline" && row("Offset", fieldBox(autoField("↧", "Distance below the baseline (empty: the font's own)", decorationOffset, (n) => set({ decorationOffset: n }))))}
                                {row("Thickness", fieldBox(autoField("≡", "Line thickness (empty: the font's own)", decorationThickness, (n) => set({ decorationThickness: n }))))}
                                {row(
                                    "Color",
                                    <div className="flex h-6 items-center gap-2">
                                        {typeof decorationColor === "string" && <ColorSwatch size={5} color={decorationColor} label="Decoration color" onChange={(c) => set({ decorationColor: c.toUpperCase() })} />}
                                        <Seg
                                            label="Decoration color"
                                            value={decorationColor === null || decorationColor === MIXED ? "auto" : "custom"}
                                            options={[
                                                { id: "auto", label: "Auto" },
                                                { id: "custom", label: "Custom" },
                                            ]}
                                            onChange={(v) => set({ decorationColor: v === "auto" ? null : ((nodes[0]?.fills.find((p) => p.type === "solid") as { color?: string } | undefined)?.color ?? "#000000") })}
                                        />
                                    </div>,
                                )}
                                {decoration === "underline" && row("Skip ink", <Check label="Skip ink" checked={skipInk !== false} onChange={(c) => set({ decorationSkipInk: c })} />)}
                            </>
                        )}
                    </>
                )}
                {shownTab === "basics" && !decorationPage && (
                    <>
                        {row(
                            "Alignment",
                            <Seg
                                label="Alignment"
                                value={shared(nodes, (node) => node.textAlign ?? "left")}
                                options={[
                                    { id: "left", label: "Align left", icon: <AlignLeft className="size-3.5" /> },
                                    { id: "center", label: "Align center", icon: <AlignCenter className="size-3.5" /> },
                                    { id: "right", label: "Align right", icon: <AlignRight className="size-3.5" /> },
                                    { id: "justify", label: "Justify", icon: <AlignJustify className="size-3.5" /> },
                                ]}
                                onChange={(textAlign) => updateLayer(nodes, () => ({ textAlign }))}
                            />,
                        )}
                        {row(
                            "Decoration",
                            <div className="flex items-center gap-1">
                                <Seg
                                    label="Decoration"
                                    value={decoration}
                                    options={[
                                        { id: "none", label: "None", icon: <NoneIcon className="size-3.5" /> },
                                        { id: "underline", label: "Underline", icon: <Underline01 className="size-3.5" /> },
                                        { id: "strikethrough", label: "Strikethrough", icon: <Strikethrough01 className="size-3.5" /> },
                                    ]}
                                    onChange={(d) => set({ decoration: d })}
                                />
                                <button type="button" aria-label="More decoration settings" onClick={() => setDecorationPage(true)} className="flex size-6 items-center justify-center rounded-md bg-field text-ink-muted hover:text-ink">
                                    <ChevronRight className="size-3.5" />
                                </button>
                            </div>,
                        )}
                        {row("Case", <Seg label="Case" value={textCase === "small-caps-forced" ? "small-caps" : textCase} options={CASE_OPTIONS} onChange={setCase} />)}
                        {divider}
                        {row(
                            "Vertical trim",
                            <Seg
                                label="Vertical trim"
                                value={shared(nodes, (n) => n.leadingTrim ?? "none")}
                                options={[
                                    { id: "none", label: "Standard", icon: <TrimIcon cap={false} className="size-4" /> },
                                    { id: "cap", label: "Cap height to baseline", icon: <TrimIcon cap className="size-4" /> },
                                ]}
                                onChange={(leadingTrim) => updateLayer(nodes, () => ({ leadingTrim }), true)}
                            />,
                        )}
                        {row(
                            "List style",
                            <Seg
                                label="List style"
                                value={listKind === null || listKind === "mixed" ? null : ((listKind || "none") as "none" | "bullet" | "number")}
                                options={[
                                    { id: "none", label: "None", icon: <NoneIcon className="size-3.5" /> },
                                    { id: "bullet", label: "Bulleted list", icon: <Dotpoints01 className="size-3.5" /> },
                                    { id: "number", label: "Numbered list", icon: <NumberedListIcon className="size-3.5" /> },
                                ]}
                                onChange={(kind) => editor.execute({ type: "batch", commands: updateParagraphs(nodes, (p) => (kind !== "none" ? { list: kind, level: Math.max(1, p.level ?? 1) } : { list: null, level: 0 })) })}
                            />,
                        )}
                        {listKind && listKind !== "mixed" && row("List spacing", fieldBox(<NumberField label="" title="List spacing" min={0} value={shared(nodes, (n) => n.listSpacing ?? 0)} onCommit={(v) => updateLayer(nodes, () => ({ listSpacing: Math.max(0, v) }), true)} />))}
                        {row(
                            "Paragraph spacing",
                            narrowBox(
                                <Bindable nodes={nodes} field="paragraphSpacing" label="paragraph spacing">
                                    <NumberField label="" title="Paragraph spacing" min={0} value={shared(nodes, (n) => n.paragraphSpacing ?? 0)} onCommit={(v) => updateLayer(nodes, () => ({ paragraphSpacing: Math.max(0, v) }), true)} />
                                </Bindable>,
                            ),
                        )}
                        {row(
                            "Truncate text",
                            <Seg
                                label="Truncate text"
                                value={truncate ? "on" : "off"}
                                options={[
                                    { id: "off", label: "Off", icon: <NoneIcon className="size-3.5" /> },
                                    { id: "on", label: "Truncate", icon: <TextGlyph>A...</TextGlyph> },
                                ]}
                                onChange={(v) => updateLayer(nodes, (n) => (v === "on" ? { truncate: true, maxLines: n.maxLines || 1 } : { truncate: false }))}
                            />,
                        )}
                        {truncate && row("Max lines", fieldBox(<NumberField label="" title="Max lines" min={1} value={shared(nodes, (n) => n.maxLines ?? 1)} onCommit={(v) => updateLayer(nodes, () => ({ maxLines: Math.max(1, Math.round(v)) }))} />))}
                        {row(
                            "Wrap style",
                            <div className="w-24 shrink-0">
                                <Select aria-label="Wrap style" value={shared(nodes, (n) => n.textWrap ?? "auto") ?? ""} onChange={(e) => e.target.value && updateLayer(nodes, () => ({ textWrap: e.target.value as SceneNode["textWrap"] }))} className={`${FIELD} w-full`}>
                                    {shared(nodes, (n) => n.textWrap ?? "auto") === null && <option value="">Mixed</option>}
                                    <option value="auto">Auto</option>
                                    <option value="balance">Balance</option>
                                    <option value="pretty">Pretty</option>
                                </Select>
                            </div>,
                        )}
                    </>
                )}
                {shownTab === "details" && (
                    <>
                        {heading("Indentation")}
                        {row("Hanging punctuation", <Check label="Hanging punctuation" checked={nodes.every((n) => n.hangingPunctuation)} onChange={(c) => updateLayer(nodes, () => ({ hangingPunctuation: c }), true)} />)}
                        {row("Hanging lists", <Check label="Hanging lists" checked={nodes.every((n) => n.hangingList)} onChange={(c) => updateLayer(nodes, () => ({ hangingList: c }), true)} />)}
                        {row(
                            "Paragraph indent",
                            fieldBox(
                                <Bindable nodes={nodes} field="paragraphIndent" label="paragraph indent">
                                    <NumberField label="" title="Paragraph indent" min={0} value={shared(nodes, (n) => n.paragraphIndent ?? 0)} onCommit={(v) => updateLayer(nodes, () => ({ paragraphIndent: Math.max(0, v) }), true)} />
                                </Bindable>,
                            ),
                        )}
                        {divider}
                        {heading("Letter case")}
                        {row("Case", <Seg label="Case" value={textCase === "small-caps-forced" ? "small-caps" : textCase} options={CASE_OPTIONS} onChange={setCase} />)}
                        {(textCase === "small-caps" || textCase === "small-caps-forced") && row("Force small caps", <Check label="Force small caps" checked={textCase === "small-caps-forced"} onChange={(c) => setCase(c ? "small-caps-forced" : "small-caps")} />)}
                        {offered("case") && row("Case-sensitive forms", <Check label="Case-sensitive forms" checked={on("case")} onChange={(c) => setFeature("case", c)} />)}
                        {offered("cpsp") && row("Capital spacing", <Check label="Capital spacing" checked={on("cpsp")} onChange={(c) => setFeature("cpsp", c)} />)}
                        {divider}
                        {heading("Numbers")}
                        {(offered("lnum") || offered("onum")) &&
                            row(
                                "Style",
                                <Seg
                                    label="Number style"
                                    value={on("onum") ? "onum" : "lnum"}
                                    options={[
                                        { id: "lnum", label: "Lining", icon: <TextGlyph>123</TextGlyph> },
                                        { id: "onum", label: "Old style", icon: <TextGlyph style={{ fontVariantNumeric: "oldstyle-nums" }}>123</TextGlyph> },
                                    ]}
                                    onChange={(t) => setFeature(t, true, [t === "onum" ? "lnum" : "onum"])}
                                />,
                            )}
                        {(offered("tnum") || offered("pnum")) &&
                            row(
                                "Spacing",
                                <Seg
                                    label="Number spacing"
                                    value={on("tnum") ? "tnum" : "pnum"}
                                    options={[
                                        { id: "pnum", label: "Proportional" },
                                        { id: "tnum", label: "Monospace" },
                                    ]}
                                    onChange={(t) => setFeature(t, true, [t === "tnum" ? "pnum" : "tnum"])}
                                />,
                            )}
                        {(offered("sups") || offered("subs")) &&
                            row(
                                "Position",
                                <Seg
                                    label="Number position"
                                    value={on("sups") ? "sups" : on("subs") ? "subs" : "normal"}
                                    options={[
                                        { id: "normal", label: "Normal", icon: <NoneIcon className="size-3.5" /> },
                                        { id: "sups", label: "Superscript", icon: <TextGlyph>x²</TextGlyph> },
                                        { id: "subs", label: "Subscript", icon: <TextGlyph>x₂</TextGlyph> },
                                    ]}
                                    onChange={(t) => (t === "normal" ? set({ openType: { ...features, sups: false, subs: false } }) : setFeature(t, true, [t === "sups" ? "subs" : "sups"]))}
                                />,
                            )}
                        {offered("frac") && row("Fractions", <Check label="Fractions" checked={on("frac")} onChange={(c) => setFeature("frac", c)} />)}
                        {offered("zero") && row("Slashed zero", <Check label="Slashed zero" checked={on("zero")} onChange={(c) => setFeature("zero", c)} />)}
                        {divider}
                        {heading("Letters")}
                        {LETTER_FEATURES.filter(([tag]) => tag !== "case" && tag !== "cpsp" && offered(tag)).map(([tag, label]) => (
                            <Fragment key={tag}>{row(label, <Check label={label} checked={on(tag)} onChange={(c) => setFeature(tag, c)} />)}</Fragment>
                        ))}
                        {supported &&
                            [...supported]
                                .filter((t) => /^ss\d\d$/.test(t))
                                .sort()
                                .map((tag) => (
                                    <Fragment key={tag}>{row(`Stylistic set ${Number(tag.slice(2))}`, <Check label={`Stylistic set ${Number(tag.slice(2))}`} checked={on(tag)} onChange={(c) => setFeature(tag, c)} />)}</Fragment>
                                ))}
                        <MoreFeatures supported={supported} on={on} onChange={setFeature} row={(label, control) => row(label, control)} />
                        {divider}
                        {heading("Other")}
                        {row(
                            "Direction",
                            fieldBox(
                                <Select aria-label="Text direction" value={shared(nodes, (n) => n.direction ?? "ltr") ?? "ltr"} onChange={(e) => updateLayer(nodes, () => ({ direction: e.target.value as SceneNode["direction"] }))} className={`${FIELD} w-full`}>
                                    <option value="ltr">Left to right</option>
                                    <option value="rtl">Right to left</option>
                                </Select>,
                            ),
                        )}
                        <div className="space-y-1 pt-1">
                            <span className="text-ink-muted">Link</span>
                            <div className="flex min-w-0 items-center gap-1">
                                <Select aria-label="Link to" value={linkKind} onChange={(e) => applyCharStyle(nodes, { hyperlink: e.target.value === "node" ? `node:${screensList[0]?.id ?? ""}` : null })} className={`${FIELD} w-[64px] shrink-0`}>
                                    <option value="url">URL</option>
                                    <option value="node">Frame</option>
                                </Select>
                                {linkKind === "node" ? (
                                    <Select aria-label="Linked frame" value={link?.slice(5) ?? ""} onChange={(e) => applyCharStyle(nodes, { hyperlink: `node:${e.target.value}` })} className={`${FIELD} min-w-0 flex-1`}>
                                        {screensList.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </Select>
                                ) : (
                                    <input
                                        ref={linkRef}
                                        key={link ?? ""}
                                        aria-label="Link"
                                        placeholder="https://"
                                        defaultValue={link ?? ""}
                                        onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === "Enter") e.currentTarget.blur();
                                        }}
                                        onBlur={(e) => {
                                            const url = e.target.value.trim() || null;
                                            if (url !== link) applyCharStyle(nodes, { hyperlink: url });
                                        }}
                                        className={`${FIELD} min-w-0 flex-1 px-2`}
                                    />
                                )}
                            </div>
                        </div>
                        {row("Font family", <VarButton nodes={nodes} field="fontFamily" label="Apply variable to font family" />)}
                        {row("Font weight", <VarButton nodes={nodes} field="fontWeight" label="Apply variable to font weight" />)}
                        {row("Font style", <VarButton nodes={nodes} field="fontStyle" label="Apply variable to font style" />)}
                    </>
                )}
                {shownTab === "variable" &&
                    axes.map((axis) => {
                        const fallback = axis.tag === "wght" ? weight : axis.tag === "opsz" ? size : axis.tag === "wdth" ? 100 : axis.tag === "slnt" || axis.tag === "ital" ? 0 : (axis.def ?? (axis.min + axis.max) / 2);
                        const clamp = (v: number) => Math.min(axis.max, Math.max(axis.min, v));
                        const current = clamp(axesValues[axis.tag] ?? fallback);
                        const stops = axisStops(axis.tag, axis.min, axis.max, variation?.instances ?? []);
                        const name = axis.name ?? AXIS_NAMES[axis.tag] ?? axis.tag;
                        const patchFor = (v: number): SpanStyle => ({ fontVariations: { ...axesValues, [axis.tag]: clamp(v) }, ...(axis.tag === "wght" ? { fontWeight: Math.round(clamp(v)) } : {}) });
                        const put = (v: number) => set(patchFor(v));
                        // Dragging the slider previews; letting go makes one undo step.
                        const slide = (v: number) => {
                            slideBase.current ??= editor.get().doc;
                            const base = slideBase.current;
                            editor.preview(applyCommand(base, { type: "batch", commands: nodes.flatMap((n) => (base.nodes[n.id] ? styleCommands([base.nodes[n.id] as SceneNode], patchFor(v)) : [])) }));
                            slideValue.current = v;
                        };
                        const release = () => {
                            const base = slideBase.current;
                            slideBase.current = null;
                            if (!base || slideValue.current === null) return;
                            editor.execute({ type: "batch", commands: nodes.flatMap((n) => (base.nodes[n.id] ? styleCommands([base.nodes[n.id] as SceneNode], patchFor(slideValue.current ?? current)) : [])) }, base);
                            slideValue.current = null;
                        };
                        return (
                            <div key={axis.tag} className="space-y-2 pb-3">
                                {row(name, fieldBox(<NumberField label="" title={name} min={axis.min} max={axis.max} value={Math.round(current * 10) / 10} onCommit={put} />))}
                                <AxisSlider label={name} min={axis.min} max={axis.max} value={current} stops={stops} onSlide={(v) => slide(snapToStop(v, stops, axis.min, axis.max))} onRelease={release} />
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

// A variable axis slider: the track fills up to the value, named instances are dots on it, and the
// thumb is a white circle with the brand ring. A native range input on top handles the dragging.
function AxisSlider({ label, min, max, value, stops, onSlide, onRelease }: { label: string; min: number; max: number; value: number; stops: { value: number; name: string }[]; onSlide: (v: number) => void; onRelease: () => void }) {
    const span = Math.max(1e-9, max - min);
    const at = (v: number) => ((v - min) / span) * 100;
    // The thumb's centre travels between the track's rounded ends.
    const pos = (v: number) => `calc(9px + (100% - 18px) * ${at(v) / 100})`;
    return (
        <div className="relative h-[18px]">
            <div className="absolute inset-0 rounded-full border border-panel-border bg-field" />
            <div className="absolute inset-y-0 left-0 rounded-full bg-brand-500" style={{ width: `calc(${pos(value)} + 9px)` }} />
            {stops.map((s) => (
                <span key={s.value} title={s.name} className={`absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${s.value <= value ? "bg-white" : "bg-ink-subtle"}`} style={{ left: pos(s.value) }} />
            ))}
            <span className="pointer-events-none absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-brand-500 bg-white shadow" style={{ left: pos(value) }} />
            <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={max - min > 20 ? 1 : 0.1}
                value={value}
                onChange={(e) => onSlide(Number(e.target.value))}
                onPointerUp={onRelease}
                onKeyUp={onRelease}
                onBlur={onRelease}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
        </div>
    );
}

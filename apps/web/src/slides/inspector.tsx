import { ArrowUp, ChevronDown, ChevronLeft, DotsGrid, Eye, EyeOff, Minus, Plus, Shuffle01, Sliders04, Stars01, Trash01, X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { hasOffline, removeOffline, saveOffline } from "../engine/offline";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { ShareButton } from "../components/collab-ui";
import { ColorSwatch } from "../components/color-picker";
import { SelectionPanel } from "../components/design-panel";
import { ExportSection } from "../components/export-section";
import { IconButton } from "../components/icon-button";
import { LayoutGuideSection } from "../components/layout-guides";
import { PaintList } from "../components/paint-list";
import { StyleButton } from "../components/style-picker";
import { PresenceAvatars } from "../components/follow-ui";
import { MenuRow } from "../components/left-sidebar";
import { Select } from "../components/select";
import { ZoomMenu } from "../components/zoom-menu";
import { editor, useEditor } from "../engine/store";
import { subtree } from "../engine/prototype";
import type { Command, NodePatch, SceneNode } from "../engine/types";
import { fitCommand } from "./autofit";
import { DEFAULT_SETTING } from "../engine/export";
import { addAnimation, addTemplateColor, addTemplateTextStyle, applyTheme, copyPresentationLink, editTemplate, remixTemplate, setSlideTemplate, setFooter, setNumberFormat, pickBackgroundImage, setAnimations, setBackground, setGradientBackground, setSlideNumbers, setTransition, setTransitionAll } from "./actions";
import { COLOR_KEYS, FONT_CHOICES, ROLE_LABELS, SLIDES_ORANGE, deckOf, roleSize, roleStyle, slideAround, slideIds, slideOf, templateColors, templatesOf, textStyleLook, themeOf } from "./model";
import { present } from "./show";
import { DEFAULT_TRANSITION, TRANSITIONS } from "./render";
import { MENU_CLASS } from "./slide-list";
import { SlidesModeIcon } from "./toolbar";
import { slides, useCurrentSlide, useSelectedSlides, useSlides } from "./state";
import { SlidePreview } from "./preview";
import { ObjectSections } from "./object-sections";
import { LIVE_KINDS, setPollOptions } from "./widgets";
import type { AnimEffect, AnimTrigger, DeckData, DeckTheme, NumberFormat, ObjectAnimation, SlideDirection, SlideEasing, TemplateTextStyle, TextRole, ThemeColorKey } from "./types";

// The right panel: Present and Share at the top, then Design (slide and theme settings, or the
// selection's properties) and Animate (the slide's transition and its layers' animations).

const field = "h-7 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

function Section({ title, action, children, tight }: { title: string; action?: React.ReactNode; children?: React.ReactNode; tight?: boolean }) {
    return (
        <section className="border-b border-panel-border px-4 pb-3">
            <div className="flex h-10 items-center justify-between">
                <h3 className="text-[11px] font-semibold">{title}</h3>
                <div className="-mr-1 flex items-center">{action}</div>
            </div>
            {children && <div className={`${tight ? "" : "pt-1"} space-y-2`}>{children}</div>}
        </section>
    );
}

// A colour's name: the template's name for it, White and Black, else its hex code.
function colorName(color: string, theme: DeckTheme): string {
    const hex = color.toUpperCase();
    const named = templateColors(theme).find((c) => c.color.toUpperCase() === hex);
    if (named) return named.name;
    if (hex === "#FFFFFF") return "White";
    if (hex === "#000000") return "Black";
    return hex.replace("#", "");
}

// A colour as a swatch and its name in an outlined row; the swatch opens the picker.
function NamedColor({ label, color, theme, onChange, after, className = "" }: { label: string; color: string; theme: DeckTheme; onChange: (color: string) => void; after?: React.ReactNode; className?: string }) {
    return (
        <div className={`flex h-6 items-center gap-2 rounded-md border border-panel-border pl-1.5 pr-1 ${className}`}>
            <ColorSwatch label={label} color={color} size={4} placement="left top" onChange={(c) => onChange(c)} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{colorName(color, theme)}</span>
            {after}
        </div>
    );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
    return (
        <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex h-7 w-full items-center justify-between">
            <span>{label}</span>
            <span className="flex h-4 w-7 items-center rounded-full p-0.5 transition-colors" style={{ background: on ? SLIDES_ORANGE : "var(--color-panel-border, #555)" }}>
                <span className={`size-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
            </span>
        </button>
    );
}

function NumberInput({ label, value, onChange, suffix, step = 50 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
    return (
        <label className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-field px-1.5">
            <span className="text-ink-muted">{label}</span>
            <input
                aria-label={label}
                type="number"
                min={0}
                step={step}
                defaultValue={value}
                key={value}
                onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== value) onChange(Math.max(0, v));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="h-7 w-full min-w-0 bg-transparent text-ink outline-none"
            />
            {suffix && <span className="text-ink-muted">{suffix}</span>}
        </label>
    );
}

// Make available offline: the deck (with its pictures) is kept in this browser, so it opens and
// presents without a connection.
async function toggleOffline(on: boolean): Promise<boolean> {
    const fileId = editor.get().fileId;
    if (!fileId) return false;
    if (!on) {
        await removeOffline(fileId);
        editor.notify("This deck is no longer kept offline.");
        return false;
    }
    const ok = await saveOffline(fileId, editor.get().doc);
    editor.notify(ok ? "Available offline: this deck opens and presents without a connection." : "Couldn't keep the deck offline in this browser.");
    return ok;
}

// Play presents from the slide on screen; its options sit behind a chevron that shows on hover.
export function PresentButton() {
    const fileId = useEditor((s) => s.fileId);
    const [offline, setOffline] = useState(false);
    useEffect(() => {
        let live = true;
        if (fileId) void hasOffline(fileId).then((on) => live && setOffline(on));
        return () => {
            live = false;
        };
    }, [fileId]);
    return (
        <div className="group flex items-center">
            <AriaMenuTrigger>
                <AriaButton aria-label="Present options" className="flex h-8 w-4 items-center justify-center rounded-md text-ink-muted opacity-0 outline-none group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 data-[pressed]:opacity-100">
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="bottom end" offset={4} className={MENU_CLASS}>
                    <AriaMenu
                        aria-label="Present"
                        className="outline-none"
                        onAction={(key) => {
                            if (key === "start") present("start");
                            else if (key === "current") present("current");
                            else if (key === "presenter") present("current", { presenterView: true });
                            else if (key === "rehearse") present("start", { rehearse: true, presenterView: true });
                            else if (key === "link") void copyPresentationLink();
                            else if (key === "offline") void toggleOffline(!offline).then(setOffline);
                        }}
                    >
                        <MenuRow id="start" label="Present from start" />
                        <MenuRow id="current" label="Present from current slide" shortcut="⌥ ⌘ ↵" />
                        <MenuRow id="presenter" label="Presenter view" />
                        <MenuRow id="rehearse" label="Rehearse" />
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="link" label="Copy presentation link" />
                        <MenuRow id="offline" label="Make available offline" checked={offline} />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <button type="button" aria-label="Present" title="Present from current slide" onClick={() => present("current")} className="flex size-8 items-center justify-center rounded-md text-ink hover:bg-panel-hover">
                <PlayIcon className="size-5" />
            </button>
        </div>
    );
}

function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...props}>
            <path d="M5.5 3.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L6.4 3.1a.6.6 0 0 0-.9.5z" />
        </svg>
    );
}

// The round help button in the corner: the slide shortcuts.
const SLIDE_SHORTCUTS: [string, [string, string][]][] = [
    [
        "Slides",
        [
            ["New slide", "⌘ ↵"],
            ["Duplicate slide", "⌘ D"],
            ["Delete slide", "⌫"],
            ["Move slide up / down", "⌘ [ / ⌘ ]"],
            ["Select several slides", "⌘ or ⇧ click"],
            ["Select every slide", "⌘ A in the list"],
            ["Next / previous slide", "↓ ↑ or Page Down / Up"],
            ["Group / ungroup slides", "⌘ G / ⇧ ⌘ G in the list"],
        ],
    ],
    [
        "Editing",
        [
            ["Move / Hand", "V / H"],
            ["Text", "T"],
            ["Rectangle / Ellipse / Line", "R / O / L"],
            ["Image or video", "⇧ ⌘ K"],
            ["Comment", "C"],
            ["Design mode", "⇧ D"],
            ["Actions", "⌘ K"],
            ["Export slides", "⇧ ⌘ E"],
        ],
    ],
    [
        "Presenting",
        [
            ["Present from this slide", "⌥ ⌘ ↵"],
            ["Next step or slide", "→ ↓ Space ↵ N Page Down"],
            ["Previous step or slide", "← ↑ P Page Up ⌫"],
            ["First / last slide", "Home / End"],
            ["Slide navigator", "G"],
            ["Go to a slide", "Number, then ↵"],
            ["Laser pointer", "L"],
            ["Black screen", "B or ."],
            ["Full screen", "F"],
            ["Shortcuts while presenting", "?"],
            ["End the show", "Esc"],
        ],
    ],
];

function HelpButton() {
    const open = useSlides((s) => s.helpOpen);
    return (
        <AriaDialogTrigger isOpen={open} onOpenChange={(helpOpen) => slides.set({ helpOpen })}>
            <AriaButton aria-label="Help and shortcuts" className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-white/[0.06] bg-panel text-[16px] text-ink shadow-[0_2px_8px_rgba(0,0,0,0.3)] outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                ?
            </AriaButton>
            <AriaPopover placement="top end" offset={8} className="max-h-[80vh] w-80 overflow-y-auto rounded-lg bg-tooltip p-3 text-[11px] text-white shadow-xl outline-none">
                <AriaDialog aria-label="Keyboard shortcuts" className="space-y-3 outline-none">
                    {SLIDE_SHORTCUTS.map(([group, rows]) => (
                        <div key={group}>
                            <div className="mb-1.5 font-semibold">{group}</div>
                            <dl className="space-y-1.5">
                                {rows.map(([label, keys]) => (
                                    <div key={label} className="flex justify-between gap-3">
                                        <dt className="text-white/80">{label}</dt>
                                        <dd className="text-right text-white/50">{keys}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    ))}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

export function SlidesInspector() {
    const tab = useSlides((s) => s.rightTab);
    const mode = useSlides((s) => s.mode);
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const slideSelected = useSlides((s) => s.slideSelected);
    const current = useCurrentSlide();
    // The slide itself: picked in the list, pressed on the canvas, or (Design mode) chosen in Layers.
    const slideChosen = Boolean(current) && (selection.length === 0 ? slideSelected : selection.length === 1 && selection[0] === current);
    const nodes = slideChosen ? [] : selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    return (
        <aside data-right-panel="" aria-label="Slide properties" className="relative flex h-full w-[240px] shrink-0 flex-col border-l border-panel-border bg-panel text-ink">
            <header className="flex h-12 shrink-0 items-center gap-1 px-2">
                <PresenceAvatars chevron />
                <div className="flex-1" />
                <PresentButton />
                <ShareButton className={`ml-1 h-8! rounded-[5px]! px-3! text-[11px]! ${mode === "slides" ? "bg-[#F24E1E]! hover:bg-[#DA4419]!" : ""}`} />
            </header>
            <div role="tablist" aria-label="Panels" className="box-content flex h-8 shrink-0 items-center gap-1 border-b border-panel-border px-2">
                {(["design", "animate"] as const).map((key) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => slides.set({ rightTab: key })} className={`h-6 rounded-md px-2 font-semibold capitalize ${tab === key ? "bg-field text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {key}
                    </button>
                ))}
                <div className="flex-1" />
                <ZoomMenu />
            </div>
            <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                {/* Room at the end so the last rows scroll clear of the help button. */}
                <div className="min-h-0 flex-1 overflow-y-auto pb-14">
                    {tab === "animate" ? (
                        <AnimatePanel />
                    ) : nodes.length ? (
                        <>
                            <ThemeTextRow nodes={nodes} />
                            <WidgetSection nodes={nodes} />
                            <ObjectSections nodes={nodes} />
                            <SelectionPanel nodes={nodes} />
                        </>
                    ) : slideChosen ? (
                        mode === "design" ? <SlideDesignPanel /> : <SlidePanel />
                    ) : (
                        <NothingSelected />
                    )}
                </div>
            </fieldset>
            <div className="pointer-events-none absolute bottom-4 right-6 flex">
                <HelpButton />
            </div>
        </aside>
    );
}

// ---- Design: nothing selected ----

function ThemeCard({ theme, active, onPress }: { theme: DeckTheme; active: boolean; onPress: () => void }) {
    return (
        <button type="button" aria-label={`${theme.name} theme`} aria-pressed={active} onClick={onPress} className="overflow-hidden rounded-md border-2 text-left" style={{ borderColor: active ? SLIDES_ORANGE : "transparent" }}>
            <div className="flex h-12 flex-col justify-center gap-1 px-2" style={{ background: theme.background }}>
                <span className="truncate text-[13px] leading-none" style={{ color: theme.text, fontFamily: theme.headingFont, fontWeight: theme.headingWeight }}>Aa</span>
                <span className="flex gap-0.5">
                    {[theme.accent, theme.muted, theme.surface].map((c) => (
                        <span key={c} className="size-2 rounded-full" style={{ background: c }} />
                    ))}
                </span>
            </div>
            <div className="truncate bg-field px-1.5 py-0.5 text-[10.5px] text-ink-muted">{theme.name}</div>
        </button>
    );
}

const WEIGHTS = [300, 400, 500, 600, 700, 800];

// Editing a template: its name, its colours (named; more can be added), its fonts and its text
// styles. Every slide on the template follows.
function ThemeEditor({ theme }: { theme: DeckTheme }) {
    const edit = (patch: Partial<DeckTheme>) => editTemplate({ ...theme, ...patch });
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const selectedText = selection.map((id) => doc.nodes[id]).find((n) => n?.type === "text");
    const colors = templateColors(theme);
    const setColor = (id: string, patch: { name?: string; color?: string }) => {
        if ((COLOR_KEYS as string[]).includes(id)) {
            const key = id as ThemeColorKey;
            edit({ ...(patch.color ? { [key]: patch.color } : {}), ...(patch.name !== undefined ? { names: { ...theme.names, [key]: patch.name } } : {}) });
        } else edit({ colors: theme.colors?.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    };
    const styles = theme.textStyles ?? [];
    const setStyle = (id: string, patch: Partial<TemplateTextStyle>) => edit({ textStyles: styles.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    return (
        <div className="space-y-2 rounded-md bg-field/50 p-2">
            <input aria-label="Template name" defaultValue={theme.name} key={theme.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== theme.name && edit({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={`${field} w-full font-semibold`} />
            <div className="flex h-5 items-center justify-between text-ink-muted">
                <span>Colors</span>
                <button type="button" aria-label="Add color" title="Add a colour to the template" onClick={() => addTemplateColor(theme)} className="flex size-5 items-center justify-center rounded hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3" />
                </button>
            </div>
            {colors.map((c) => (
                <div key={c.id} className="flex h-7 items-center gap-2">
                    <ColorSwatch label={c.name} color={c.color} size={5} onChange={(color) => setColor(c.id, { color: color.toUpperCase() })} />
                    <input aria-label={`${c.name} name`} defaultValue={c.name} key={c.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && setColor(c.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={field} />
                    <span className="w-12 font-mono text-[10.5px] text-ink-muted">{c.color.replace("#", "").toUpperCase()}</span>
                    {!(COLOR_KEYS as string[]).includes(c.id) && (
                        <button type="button" aria-label={`Remove ${c.name}`} onClick={() => edit({ colors: theme.colors?.filter((x) => x.id !== c.id) })} className="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Minus className="size-3" />
                        </button>
                    )}
                </div>
            ))}
            <label className="flex items-center gap-2">
                <span className="w-16 text-ink-muted">Headings</span>
                <Select aria-label="Heading font" value={theme.headingFont} onChange={(e) => edit({ headingFont: e.target.value })} className={field}>
                    {FONT_CHOICES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </Select>
            </label>
            <label className="flex items-center gap-2">
                <span className="w-16 text-ink-muted">Body</span>
                <Select aria-label="Body font" value={theme.bodyFont} onChange={(e) => edit({ bodyFont: e.target.value })} className={field}>
                    {FONT_CHOICES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </Select>
            </label>
            <div className="flex h-5 items-center justify-between text-ink-muted">
                <span>Text styles</span>
                <button type="button" aria-label="Add text style" title={selectedText ? "Add a text style from the selected text" : "Add a text style"} onClick={() => addTemplateTextStyle(theme, selectedText)} className="flex size-5 items-center justify-center rounded hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3" />
                </button>
            </div>
            {styles.map((t) => (
                <div key={t.id} className="space-y-1 rounded-md border border-panel-border p-1.5">
                    <div className="flex items-center gap-1">
                        <input aria-label="Text style name" defaultValue={t.name} key={t.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && setStyle(t.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={field} style={{ fontFamily: t.fontFamily, fontWeight: t.fontWeight }} />
                        <button type="button" aria-label={`Remove ${t.name}`} onClick={() => edit({ textStyles: styles.filter((x) => x.id !== t.id) })} className="flex size-5 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                            <Minus className="size-3" />
                        </button>
                    </div>
                    <div className="flex gap-1">
                        <Select aria-label="Text style font" value={t.fontFamily} onChange={(e) => setStyle(t.id, { fontFamily: e.target.value })} className={field}>
                            {FONT_CHOICES.map((f) => (
                                <option key={f} value={f}>{f}</option>
                            ))}
                        </Select>
                        <Select aria-label="Text style weight" value={String(t.fontWeight)} onChange={(e) => setStyle(t.id, { fontWeight: Number(e.target.value) })} className={`${field} w-16 flex-none`}>
                            {WEIGHTS.map((w) => (
                                <option key={w} value={w}>{w}</option>
                            ))}
                        </Select>
                    </div>
                    <div className="flex gap-1">
                        <NumberInput label="Size" value={t.fontSize} step={1} onChange={(v) => v > 0 && setStyle(t.id, { fontSize: v })} />
                        <Select aria-label="Text style colour" value={t.color} onChange={(e) => setStyle(t.id, { color: e.target.value })} className={field}>
                            {colors.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </Select>
                    </div>
                </div>
            ))}
        </div>
    );
}

// Nothing on the slide is selected and the slide itself isn't either.
function NothingSelected() {
    return (
        <div className="flex h-full min-h-64 flex-col items-center justify-center px-5 pb-16 text-center">
            <span className="flex size-8 items-center justify-center rounded-full" style={{ background: "rgba(242, 78, 30, 0.22)", color: "#FF9A7A" }}>
                <SelectIcon className="size-4" />
            </span>
            <div className="mt-3.5 text-[11.5px] font-semibold">No element selected</div>
            <div className="mt-3 text-[11px] leading-4 text-ink-muted">Select an element on your slide to inspect and edit its properties</div>
        </div>
    );
}

function SelectIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M5.5 2.5h-2a1 1 0 0 0-1 1v2M10.5 2.5h2a1 1 0 0 1 1 1v2M2.5 10.5v2a1 1 0 0 0 1 1h2" />
            <path d="M7.5 7.5l6 2.2-2.6.9-.9 2.6z" />
        </svg>
    );
}

// The slide's template: its swatch, name and font on a card that opens the deck's templates (pick
// one for the selected slides, or browse more); the sliders button opens the same card with the
// template editable. Remix sits next to the card.
function TemplateStyleSection() {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [view, setView] = useState<TemplateView>("templates");
    const doc = useEditor((s) => s.doc);
    const current = useCurrentSlide();
    const theme = themeOf(doc, current);
    return (
        <Section
            title="Template style"
            action={
                <button
                    type="button"
                    aria-label="Edit template style"
                    title="Edit the template style"
                    onClick={() => {
                        setEditing(false);
                        setView("styles");
                        setOpen(true);
                    }}
                    className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink"
                >
                    <Sliders04 className="size-3.5" />
                </button>
            }
            tight
        >
            <div className="flex items-center">
                <TemplateStyle
                    theme={theme}
                    open={open}
                    onOpenChange={(next) => {
                        // The card itself opens the template list; the sliders button the styles.
                        if (next && !open) setView("templates");
                        setOpen(next);
                    }}
                    view={view}
                    setView={setView}
                    editing={editing}
                    setEditing={setEditing}
                />
            </div>
        </Section>
    );
}

function TemplateSwatch({ theme }: { theme: DeckTheme }) {
    return (
        <span className="flex size-8 shrink-0 overflow-hidden rounded-[3px] border border-white/10">
            {[theme.surface, theme.muted, theme.accent].map((c, i) => (
                <span key={i} className="h-full flex-1" style={{ background: c }} />
            ))}
        </span>
    );
}

// Every slide's number and footer: deck settings, so they sit with the template style (the reference
// adds a slide number from + › Other tools, which Insert › Slide number also does here). Skipping a
// slide, its layout and hiding the footer on one slide are on the slide's menu in the list.
function DeckSettings() {
    const doc = useEditor((s) => s.doc);
    const deck = deckOf(doc);
    return (
        <div className="space-y-1.5 border-t border-panel-border pt-2" aria-label="Slide numbers and footer">
            <div className="font-semibold">Every slide</div>
            <Toggle label="Slide numbers" on={Boolean(deck.slideNumbers)} onChange={setSlideNumbers} />
            {deck.slideNumbers && (
                <Select aria-label="Slide number format" value={deck.numberFormat ?? "plain"} onChange={(e) => setNumberFormat(e.target.value as NumberFormat)} className={`${field} w-full`}>
                    <option value="plain">Number only (3)</option>
                    <option value="slash">With total (3 / 12)</option>
                    <option value="of">With total (3 of 12)</option>
                </Select>
            )}
            <label className="flex items-center gap-2">
                <span className="w-12 text-ink-muted">Footer</span>
                <input
                    aria-label="Footer on every slide"
                    placeholder="Text on every slide"
                    defaultValue={deck.footer ?? ""}
                    key={deck.footer ?? ""}
                    onBlur={(e) => e.target.value.trim() !== (deck.footer ?? "") && setFooter(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className={field}
                />
            </label>
        </div>
    );
}

type TemplateView = "styles" | "templates";

// The template's text styles and colours, as the reference's style card: one 32pt row per style
// drawn in that style ("Inter · 96"), then a 7-across grid of 28pt colour swatches.
function TemplateStylesView({ theme, onEdit }: { theme: DeckTheme; onEdit: () => void }) {
    const roles = (["title", "heading", "body", "caption"] as TextRole[]).map((role) => {
        const style = roleStyle(theme, role);
        return { id: role, name: ROLE_LABELS[role], family: String(style.fontFamily ?? theme.bodyFont), weight: Number(style.fontWeight ?? 400), size: roleSize(role) };
    });
    const rows = [...roles, ...(theme.textStyles ?? []).map((t) => ({ id: t.id, name: t.name, family: t.fontFamily, weight: t.fontWeight, size: t.fontSize }))];
    // The previews scale the real sizes down to fit a 32pt row (96 → 20, 16 → 12).
    const preview = (size: number) => Math.round(Math.min(20, Math.max(12, 9 + size / 9)));
    const heading = "flex h-10 items-center justify-between pr-1 pl-[14px] font-semibold";
    const add = "flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <>
            <div className={heading}>
                <span>Text styles</span>
                <button type="button" aria-label="Add text style" title="Edit the template's text styles" onClick={onEdit} className={add}>
                    <Plus className="size-3.5" />
                </button>
            </div>
            <div className="pb-4">
                {rows.map((r) => (
                    <div key={r.id} className="flex h-8 items-center justify-between gap-2 pr-[14px] pl-[14px]">
                        <span className="min-w-0 truncate" style={{ fontFamily: r.family, fontWeight: r.weight, fontSize: preview(r.size) }}>
                            {r.name}
                        </span>
                        <span className="shrink-0 text-[9px] text-ink-muted">
                            {r.family} · {r.size}
                        </span>
                    </div>
                ))}
            </div>
            <div className="border-t border-panel-border" />
            <div className={heading}>
                <span>Colors</span>
                <button type="button" aria-label="Add color" title="Edit the template's colours" onClick={onEdit} className={add}>
                    <Plus className="size-3.5" />
                </button>
            </div>
            <div className="grid grid-cols-[repeat(7,28px)] gap-2 pt-0.5 pb-[21px] pl-[14px]">
                {templateColors(theme).map((c) => (
                    <span key={c.id} title={`${c.name} ${c.color.toUpperCase()}`} className="size-7 rounded-[5px] border border-black/10 dark:border-white/10" style={{ background: c.color }} />
                ))}
            </div>
        </>
    );
}

// The template style popover (280 wide). Its first view matches the reference: a header with the
// template's name, then its text styles and colours. The second view holds the rest: the
// templates in this file, Browse / Remix / Apply to all, the style editor and Every slide.
function TemplateStyle({ theme, open, onOpenChange, view, setView, editing, setEditing }: { theme: DeckTheme; open: boolean; onOpenChange: (open: boolean) => void; view: TemplateView; setView: (view: TemplateView) => void; editing: boolean; setEditing: (on: boolean) => void }) {
    const doc = useEditor((s) => s.doc);
    const picked = useSelectedSlides();
    const inFile = templatesOf(doc);
    const mixed = inFile.length > 1;
    const icon = "flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink";
    return (
        <AriaDialogTrigger isOpen={open} onOpenChange={onOpenChange}>
            <AriaButton aria-label="Template style" className="flex h-[47px] min-w-0 flex-1 items-center gap-2.5 rounded-md border border-panel-border px-[7px] text-left outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                <TemplateSwatch theme={theme} />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[11px] font-medium leading-4 text-ink">{theme.name}</span>
                    <span className="truncate text-[11px] leading-4 text-ink-muted">{theme.bodyFont}</span>
                </span>
            </AriaButton>
            <AriaPopover placement="left top" offset={12} className="max-h-[80vh] w-[280px] overflow-y-auto rounded-[13px] border border-panel-border bg-panel-raised text-[11px] text-ink shadow-xl outline-none">
                <AriaDialog aria-label="Template styles" className="outline-none">
                    {({ close }) => (
                        <>
                            <div className="flex h-[38px] items-center justify-between gap-1 border-b border-panel-border pr-2 pl-[14px]">
                                {view === "styles" ? (
                                    <span className="min-w-0 truncate font-semibold">{theme.name}</span>
                                ) : (
                                    <button type="button" onClick={() => setView("styles")} className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1 font-semibold hover:bg-panel-hover">
                                        <ChevronLeft className="size-3.5 shrink-0" />
                                        <span className="truncate">Templates and settings</span>
                                    </button>
                                )}
                                <span className="flex shrink-0 items-center gap-0.5">
                                    {view === "styles" && (
                                        <button type="button" aria-label="Templates and settings" title="Templates in this file, remix, apply to all, edit the style, slide numbers and footer" onClick={() => setView("templates")} className={icon}>
                                            <Sliders04 className="size-3.5" />
                                        </button>
                                    )}
                                    <button type="button" aria-label="Close" onClick={close} className={icon}>
                                        <X className="size-3.5" />
                                    </button>
                                </span>
                            </div>
                            {view === "styles" ? (
                                <TemplateStylesView
                                    theme={theme}
                                    onEdit={() => {
                                        setEditing(true);
                                        setView("templates");
                                    }}
                                />
                            ) : (
                                <div className="space-y-2 p-3">
                                    <div className="flex h-6 items-center justify-between">
                                        <span className="text-ink-muted">In this file{picked.length > 1 ? `: picking one changes the ${picked.length} selected slides` : ""}</span>
                                        <button type="button" onClick={() => setEditing(!editing)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-panel-hover hover:text-ink">
                                            {editing ? "Done" : "Edit style"}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {inFile.map((t) => (
                                            <ThemeCard key={t.id} theme={t} active={theme.id === t.id} onPress={() => setSlideTemplate(picked, t)} />
                                        ))}
                                    </div>
                                    <div className="flex gap-1.5">
                                        <button type="button" onClick={() => slides.set({ libraryOpen: true })} className="h-7 flex-1 rounded-md bg-field hover:bg-panel-hover">Browse templates</button>
                                        <button type="button" aria-label="Remix template colors" title="Remix template colors" onClick={() => remixTemplate(theme)} className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-field px-2 hover:bg-panel-hover">
                                            <Shuffle01 className="size-3.5" /> Remix
                                        </button>
                                        {(mixed || picked.length < slideIds(doc).length) && (
                                            <button type="button" title="Put every slide on this template" onClick={() => applyTheme(theme)} className="h-7 flex-1 rounded-md bg-field hover:bg-panel-hover">
                                                Apply to all slides
                                            </button>
                                        )}
                                    </div>
                                    {editing && <ThemeEditor theme={theme} />}
                                    <DeckSettings />
                                </div>
                            )}
                        </>
                    )}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

type BackgroundKind = "solid" | "gradient" | "image";

function BackgroundKindIcon({ kind }: { kind: BackgroundKind }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="size-4" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            {kind === "solid" && <rect x="5" y="5" width="6" height="6" rx="0.8" fill="currentColor" stroke="none" opacity="0.85" />}
            {kind === "gradient" && <path d="M5.5 5v6M8 5v6M10.5 5v6" strokeDasharray="1 1.2" />}
            {kind === "image" && (
                <>
                    <circle cx="10.2" cy="5.8" r="1" />
                    <path d="M2.5 11.5l3.5-3.2 3.2 3 1.6-1.4 2.7 2.4" strokeLinejoin="round" />
                </>
            )}
        </svg>
    );
}

// Every flat colour on the slide (its background, its layers' fills and strokes), one row each;
// changing a row recolours every use.
function SelectionColors({ slide }: { slide: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const theme = themeOf(doc, slide.id);
    const groups = new Map<string, { color: string; uses: { id: string; key: "fills" | "strokes"; index: number }[] }>();
    // The slide's layers first, then its own background (as the reference lists them).
    const all = subtree(doc, slide.id);
    for (const node of [...all.filter((n) => n.id !== slide.id), ...all.filter((n) => n.id === slide.id)]) {
        for (const key of ["fills", "strokes"] as const) {
            node[key].forEach((paint, index) => {
                if (paint.type !== "solid" || !paint.visible) return;
                const id = paint.color.toUpperCase();
                const g = groups.get(id) ?? { color: id, uses: [] };
                g.uses.push({ id: node.id, key, index });
                groups.set(id, g);
            });
        }
    }
    if (!groups.size) return null;
    const apply = (uses: { id: string; key: "fills" | "strokes"; index: number }[], color: string) => {
        const byNode = new Map<string, { key: "fills" | "strokes"; index: number }[]>();
        for (const u of uses) byNode.set(u.id, [...(byNode.get(u.id) ?? []), u]);
        editor.execute({
            type: "batch",
            commands: [...byNode.entries()].map(([id, hits]) => {
                const node = doc.nodes[id] as SceneNode;
                const patch: NodePatch = {};
                for (const key of ["fills", "strokes"] as const) {
                    const mine = hits.filter((u) => u.key === key);
                    if (mine.length) patch[key] = node[key].map((p, i) => (mine.some((u) => u.index === i) && p.type === "solid" ? { ...p, color } : p));
                }
                // The slide's own colour is also its deck setting, so theme changes keep it.
                const info = slideOf(node);
                if (info && patch.fills) patch.deck = { ...info, background: color };
                return { type: "node.update" as const, id, patch };
            }),
        });
    };
    return (
        <Section title="Selection colors">
            {[...groups.values()].map((g) => (
                <NamedColor key={g.color} label={`${colorName(g.color, theme)} colour`} color={g.color} theme={theme} onChange={(c) => apply(g.uses, c.toUpperCase())} className="w-[156px]" />
            ))}
        </Section>
    );
}

function SlidePanel() {
    const doc = useEditor((s) => s.doc);
    const id = useCurrentSlide();
    const slide = id ? doc.nodes[id] : undefined;
    const info = slideOf(slide);
    if (!slide || !info || !id) return null;
    const theme = themeOf(doc, id);
    const background = info.background ?? theme.background;
    const paint = slide.fills[0];
    const kind: BackgroundKind = paint?.type === "image" ? "image" : paint && paint.type !== "solid" && "stops" in paint ? "gradient" : "solid";
    const stops = paint && "stops" in paint ? paint.stops : null;
    const number = slideIds(doc).indexOf(id) + 1;
    const pick = (next: BackgroundKind) => {
        if (next === kind && next !== "image") return;
        if (next === "solid") setBackground(id, info.background ?? null);
        else if (next === "gradient") setGradientBackground(id, background, theme.surface === background ? theme.muted : theme.surface);
        else pickBackgroundImage(id);
    };
    const themeColors = templateColors(theme).map((c): [string, string] => [c.name, c.color]);
    const colorMenu = (
        <AriaMenuTrigger>
            <AriaButton aria-label="Template colors" className="flex size-5 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <ChevronDown className="size-3" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={4} className={MENU_CLASS}>
                <AriaMenu
                    aria-label="Template colors"
                    className="outline-none"
                    onAction={(key) => {
                        if (key === "theme") setBackground(id, null);
                        else setBackground(id, String(key));
                    }}
                >
                    <MenuRow id="theme" label="Follow the template style" checked={!info.background} />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    {themeColors.map(([label, color]) => (
                        <AriaMenuItem key={`${label}${color}`} id={color} textValue={label} className="flex h-7 cursor-default items-center gap-2 rounded px-2 text-[11px] outline-none data-[focused]:bg-brand-500">
                            <span className="size-3.5 rounded-sm border border-white/20" style={{ background: color }} />
                            <span className="flex-1">{label}</span>
                            <span className="text-white/50">{color.replace("#", "").toUpperCase()}</span>
                        </AriaMenuItem>
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
    return (
        <>
            <SlideHeading number={number} />
            <TemplateStyleSection />
            <Section title="Background">
                <div role="radiogroup" aria-label="Background type" className="flex h-6 rounded-md bg-field p-0.5">
                    {(["solid", "gradient", "image"] as const).map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={kind === k} aria-label={k === "solid" ? "Solid colour" : k === "gradient" ? "Gradient" : "Image"} title={k === "solid" ? "Solid colour" : k === "gradient" ? "Gradient" : "Image"} onClick={() => pick(k)} className={`flex flex-1 items-center justify-center rounded ${kind === k ? "bg-white/[0.07] text-ink" : "text-ink-muted hover:text-ink"}`}>
                            <BackgroundKindIcon kind={k} />
                        </button>
                    ))}
                </div>
                {kind === "solid" && <NamedColor label="Slide background" color={background} theme={theme} onChange={(c) => setBackground(id, c)} after={colorMenu} />}
                {kind === "gradient" && stops && (
                    <>
                        <NamedColor label="Gradient start" color={stops[0]?.color ?? background} theme={theme} onChange={(c) => setGradientBackground(id, c, stops[stops.length - 1]?.color ?? c)} />
                        <NamedColor label="Gradient end" color={stops[stops.length - 1]?.color ?? background} theme={theme} onChange={(c) => setGradientBackground(id, stops[0]?.color ?? c, c)} />
                    </>
                )}
                {kind === "image" && (
                    <div className="flex h-6 items-center gap-2 rounded-md border border-panel-border pl-2 pr-1">
                        <span className="flex-1 text-ink-muted">Image fills the slide</span>
                        <button type="button" onClick={() => pickBackgroundImage(id)} className="rounded px-1.5 text-ink hover:bg-panel-hover">Replace</button>
                    </div>
                )}
            </Section>
            <SelectionColors slide={slide} />
        </>
    );
}

// "Slide N", with the actions palette (and the agent) behind the sparkle.
function SlideHeading({ number, plain }: { number: number; plain?: boolean }) {
    return (
        <div className="box-content flex h-12 items-center justify-between border-b border-panel-border pr-3 pl-4 text-[13px] font-semibold">
            <span>Slide {number}</span>
            {/* Design mode's heading is the name alone (the actions are on the toolbar and ⌘K). */}
            {!plain && <button type="button" aria-label="Actions and AI" title="Actions and AI (⌘K)" onClick={() => editor.set({ actionsOpen: true })} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                <Stars01 className="size-3.5" />
            </button>}
        </div>
    );
}

// Design mode with the slide chosen: the slide as a frame. Its fill, every colour on it, its
// layout guides and its export settings.
function SlideDesignPanel() {
    const doc = useEditor((s) => s.doc);
    const id = useCurrentSlide();
    const slide = id ? doc.nodes[id] : undefined;
    const info = slideOf(slide);
    const theme = themeOf(doc, id);
    if (!slide || !info || !id) return null;
    const number = slideIds(doc).indexOf(id) + 1;
    const paint = slide.fills[0];
    const setFills = (fills: SceneNode["fills"]) => editor.execute({ type: "node.update", id, patch: { fills } });
    return (
        <>
            <SlideHeading number={number} plain />
            <TemplateStyleSection />
            {paint && paint.type !== "solid" ? (
                <PaintList nodes={[slide]} paintKey="fills" title="Fill" />
            ) : (
                <Section
                    title="Fill"
                    action={
                        <>
                            <StyleButton kind="color" nodes={[slide]} target="fills" label="Fill styles" />
                            <IconButton size="sm" icon={Plus} label="Add fill" disabled={Boolean(paint)} onPress={() => setBackground(id, null)} />
                        </>
                    }
                >
                    {paint && (
                        <div className={`flex items-center gap-1 ${paint.visible ? "" : "opacity-60"}`}>
                            <NamedColor label="Fill" color={paint.color} theme={theme} onChange={(c) => setBackground(id, c)} className="w-[156px]" />
                            <div className="flex-1" />
                            <IconButton size="sm" icon={paint.visible ? Eye : EyeOff} label={paint.visible ? "Hide fill" : "Show fill"} onPress={() => setFills([{ ...paint, visible: !paint.visible }])} />
                            <IconButton size="sm" icon={Minus} label="Remove fill" onPress={() => setFills([])} />
                        </div>
                    )}
                </Section>
            )}
            <SelectionColors slide={slide} />
            <section className="border-b border-panel-border px-4 pb-4 pt-3">
                <LayoutGuideSection frames={[slide]} strong />
            </section>
            {/* A slide starts with one export row (PNG at 1x), so Export is ready to press. */}
            <ExportSection nodes={[slide.exportSettings?.length ? slide : { ...slide, exportSettings: [{ ...DEFAULT_SETTING }] }]} label={doc.name || "Untitled"} />
        </>
    );
}

// ---- Design: a selection ----

// Text styles from the template for selected text: the role (or a text style the template added)
// decides font, weight, colour and size.
function ThemeTextRow({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const texts = nodes.filter((n) => n.type === "text");
    if (!texts.length || texts.length !== nodes.length) return null;
    const theme = themeOf(doc, slideAround(doc, texts[0]?.id)?.id);
    const keys = new Set(texts.map((n) => (n.deck?.kind === "text" ? (n.deck.style ? `style:${n.deck.style}` : n.deck.role) : "")));
    const value = keys.size === 1 ? [...keys][0] : "";
    return (
        <Section
            title="Text style"
            action={
                <button type="button" aria-label="Add text style to the template" title="Add a text style to the template from this text" onClick={() => {
                    const id = addTemplateTextStyle(theme, texts[0]);
                    editor.execute({ type: "batch", commands: texts.map((n) => ({ type: "node.update" as const, id: n.id, patch: { deck: { kind: "text" as const, role: n.deck?.kind === "text" ? n.deck.role : ("body" as TextRole), style: id } } })) });
                }} className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <Plus className="size-3.5" />
                </button>
            }
        >
            <Select
                aria-label="Theme text style"
                value={value || "none"}
                onChange={(e) => {
                    const key = e.target.value;
                    const styleId = key.startsWith("style:") ? key.slice(6) : undefined;
                    const style = styleId ? theme.textStyles?.find((t) => t.id === styleId) : undefined;
                    editor.execute({
                        type: "batch",
                        commands: texts.map((n) => {
                            if (key === "none") return { type: "node.update" as const, id: n.id, patch: { deck: undefined } };
                            const role = style ? (n.deck?.kind === "text" ? n.deck.role : "body") : (key as TextRole);
                            const look = style ? textStyleLook(theme, style) : { ...roleStyle(theme, role), fontSize: roleSize(role) };
                            return { type: "node.update" as const, id: n.id, patch: { ...look, deck: { kind: "text" as const, role, ...(styleId ? { style: styleId } : {}) } } };
                        }),
                    });
                }}
                className={`${field} w-full`}
            >
                <option value="none">None (not themed)</option>
                {(Object.keys(ROLE_LABELS) as TextRole[]).map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
                {theme.textStyles?.map((t) => (
                    <option key={t.id} value={`style:${t.id}`}>{t.name}</option>
                ))}
            </Select>
            <AutoFitToggle texts={texts} />
            {texts.length > 1 && <MultiEditText texts={texts} />}
        </Section>
    );
}

// Auto-fit: themed text in a fixed box shrinks to fit it. Turning it on fixes the box's height.
function AutoFitToggle({ texts }: { texts: SceneNode[] }) {
    const themed = texts.filter((t) => t.deck?.kind === "text");
    if (!themed.length) return null;
    const on = themed.every((t) => t.deck?.kind === "text" && t.deck.fit);
    const toggle = (next: boolean) => {
        const commands: Command[] = [];
        for (const t of themed) {
            if (t.deck?.kind !== "text") continue;
            const deck = { ...t.deck, fit: next ? (t.deck.fit ?? t.fontSize ?? roleSize(t.deck.role)) : undefined };
            const node = { ...t, deck, sizing: { ...t.sizing, v: "fixed" as const } };
            commands.push({ type: "node.update", id: t.id, patch: next ? { deck, sizing: node.sizing } : { deck, fontSize: t.deck.fit ?? t.fontSize } });
            const fit = next ? fitCommand(node) : null;
            if (fit) commands.push(fit);
        }
        editor.execute({ type: "batch", commands });
    };
    return <Toggle label="Auto-fit text" on={on} onChange={toggle} />;
}

// Several text layers selected: type once and they all say it (applied when the field loses focus).
function MultiEditText({ texts }: { texts: SceneNode[] }) {
    const same = texts.every((t) => t.text === texts[0]?.text);
    const value = same ? (texts[0]?.text ?? "") : "";
    return (
        <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Multi-edit text ({texts.length} layers)</span>
            <textarea
                aria-label="Multi-edit text"
                placeholder={same ? "" : "Mixed. Type to replace them all."}
                defaultValue={value}
                key={texts.map((t) => `${t.id}:${t.text}`).join("|")}
                rows={2}
                onBlur={(e) => {
                    if (e.target.value === value) return;
                    editor.execute({ type: "batch", commands: texts.map((t) => ({ type: "node.update" as const, id: t.id, patch: { text: e.target.value, spans: undefined } })) });
                }}
                className="w-full resize-none rounded-md border border-transparent bg-field p-1.5 text-ink outline-none placeholder:text-ink-muted focus:border-brand-500"
            />
        </label>
    );
}

function WidgetSection({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    const node = nodes.length === 1 ? nodes[0] : undefined;
    const data = node?.deck;
    if (!node || !data || !(LIVE_KINDS as string[]).includes(data.kind)) return null;
    const child = (name: string) => node.children.map((c) => doc.nodes[c]).find((c) => c?.name === name);
    const update = (patch: Partial<DeckData>, texts: Record<string, string> = {}) => {
        const commands = [{ type: "node.update" as const, id: node.id, patch: { deck: { ...data, ...patch } as DeckData } }];
        for (const [name, text] of Object.entries(texts)) {
            const c = child(name);
            if (c) commands.push({ type: "node.update" as const, id: c.id, patch: { text } as never });
        }
        editor.execute({ type: "batch", commands });
    };
    const input = (label: string, value: string, onCommit: (v: string) => void) => (
        <label className="flex flex-col gap-1">
            <span className="text-ink-muted">{label}</span>
            <input aria-label={label} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && onCommit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={`${field} w-full`} />
        </label>
    );
    const answers = data.kind === "poll" || data.kind === "scale" ? Object.keys(data.votes).length : data.kind === "stamps" ? data.stamps.length : 0;
    const title = data.kind === "poll" ? "Poll" : data.kind === "scale" ? "Alignment scale" : data.kind === "stamps" ? "Live stamps" : data.kind === "facepile" ? "Facepile" : data.kind === "video-link" ? "Video" : data.kind === "embed" && data.prototype ? "Prototype" : "Embed";
    return (
        <Section title={title}>
            {data.kind === "poll" && (
                <>
                    {input("Question", data.question, (v) => update({ question: v }, { Question: v }))}
                    <label className="flex flex-col gap-1">
                        <span className="text-ink-muted">Options, one per line</span>
                        <textarea
                            aria-label="Options"
                            defaultValue={data.options.join("\n")}
                            key={data.options.join("\n")}
                            rows={4}
                            onBlur={(e) => {
                                const options = e.target.value.split("\n").map((o) => o.trim()).filter(Boolean);
                                if (options.length && options.join("\n") !== data.options.join("\n")) setPollOptions(node.id, options);
                            }}
                            className="w-full rounded-md border border-transparent bg-field p-1.5 text-ink outline-none focus:border-brand-500"
                        />
                    </label>
                </>
            )}
            {data.kind === "scale" && (
                <>
                    {input("Question", data.question, (v) => update({ question: v }, { Question: v }))}
                    <div className="flex gap-2">
                        {input("Left", data.left, (v) => update({ left: v }, { "Left label": v }))}
                        {input("Right", data.right, (v) => update({ right: v }, { "Right label": v }))}
                    </div>
                </>
            )}
            {data.kind === "stamps" && input("Prompt", data.prompt, (v) => update({ prompt: v }, { Question: v }))}
            {data.kind === "embed" && !data.prototype && input("Address", data.url, (v) => update({ url: v }, { Question: v }))}
            {data.kind === "embed" && data.prototype && (
                <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{data.prototype.name}</span>
                    <button type="button" onClick={() => slides.set({ prototypeOpen: node.id })} className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-panel-hover hover:text-ink">Change</button>
                </div>
            )}
            {data.kind === "video-link" && (
                <>
                    {input("Video link", data.url, (v) => update({ url: v.trim() }, { Question: v.trim() || "Paste a video link in the right panel" }))}
                    <NumberInput label="Start" value={data.start ?? 0} step={1} suffix="s" onChange={(v) => update({ start: v })} />
                    <Toggle label="Play by itself" on={Boolean(data.autoplay)} onChange={(on) => update({ autoplay: on })} />
                </>
            )}
            {data.kind === "facepile" && <div className="text-ink-muted">Shows the faces of everyone watching.</div>}
            {(data.kind === "poll" || data.kind === "scale") && <Toggle label="Hide results until revealed" on={Boolean(data.hideResults)} onChange={(on) => update({ hideResults: on })} />}
            {(data.kind === "poll" || data.kind === "scale" || data.kind === "stamps") && (
                <div className="flex items-center justify-between text-ink-muted">
                    <span>{answers} response{answers === 1 ? "" : "s"}</span>
                    <button type="button" disabled={!answers} onClick={() => update(data.kind === "stamps" ? { stamps: [] } : { votes: {} })} className="rounded px-1.5 py-0.5 hover:bg-panel-hover hover:text-ink disabled:opacity-40">Clear responses</button>
                </div>
            )}
            {(data.kind === "poll" || data.kind === "scale" || data.kind === "stamps") && <div className="text-ink-muted">The audience answers while you present.</div>}
        </Section>
    );
}

// ---- Animate ----

// The slide's animations in order, in sequences: each "On click" starts one (numbered), and the
// ones under it play with it or after it (indented). Drag a row by its handle to reorder; drop it
// indented under another to join that sequence, or flush left to start one of its own.
function AnimationList({ anims, write, open, setOpen, patch }: { anims: ObjectAnimation[]; write: (list: ObjectAnimation[]) => void; open: string | null; setOpen: (id: string | null) => void; patch: (id: string, p: Partial<ObjectAnimation>) => void }) {
    const doc = useEditor((s) => s.doc);
    const [drag, setDrag] = useState<string | null>(null);
    const [drop, setDrop] = useState<{ before: number; indent: boolean } | null>(null);
    const listRef = useRef<HTMLOListElement | null>(null);
    const finish = () => {
        if (drag && drop) {
            const moving = anims.find((a) => a.id === drag);
            if (moving) {
                const rest = anims.filter((a) => a.id !== drag);
                const from = anims.indexOf(moving);
                const at = drop.before > from ? drop.before - 1 : drop.before;
                const indent = drop.indent && at > 0;
                const trigger: AnimTrigger = indent ? (moving.trigger === "click" ? "with" : moving.trigger) : "click";
                rest.splice(at, 0, { ...moving, trigger });
                // The first animation can't play with one before it: it starts the slide's first sequence.
                write(rest);
            }
        }
        setDrag(null);
        setDrop(null);
    };
    let step = 0;
    return (
        <ol ref={listRef} aria-label="Animations" className="relative space-y-1" onDragOver={(e) => drag && e.preventDefault()} onDrop={finish}>
            {anims.map((a, i) => {
                const target = doc.nodes[a.target];
                if (a.trigger === "click") step++;
                const nested = a.trigger !== "click" && i > 0;
                const expanded = open === a.id;
                const lineHere = drag && drop?.before === i;
                return (
                    <li
                        key={a.id}
                        className={`relative rounded-md ${expanded ? "bg-field/60" : ""} ${nested ? "ml-4" : ""} ${drag === a.id ? "opacity-50" : ""}`}
                        onDragOver={(e) => {
                            if (!drag) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            const before = e.clientY < r.top + r.height / 2 ? i : i + 1;
                            const left = listRef.current?.getBoundingClientRect().left ?? 0;
                            const indent = before > 0 && e.clientX - left > 28;
                            if (!drop || drop.before !== before || drop.indent !== indent) setDrop({ before, indent });
                        }}
                        onDrop={(e) => {
                            e.stopPropagation();
                            finish();
                        }}
                    >
                        {lineHere && <div aria-hidden="true" className="absolute -top-[3px] right-0 h-0.5 rounded" style={{ left: drop?.indent ? 16 : 0, background: SLIDES_ORANGE }} />}
                        {drag && drop?.before === anims.length && i === anims.length - 1 && <div aria-hidden="true" className="absolute -bottom-[3px] right-0 h-0.5 rounded" style={{ left: drop.indent ? 16 : 0, background: SLIDES_ORANGE }} />}
                        <div className="flex h-7 items-center gap-1 rounded-md px-1 hover:bg-panel-hover">
                            <span
                                draggable
                                role="button"
                                tabIndex={-1}
                                aria-label="Drag to reorder"
                                title="Drag to reorder; drop indented to play with the one above"
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("text/x-animation", a.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    setDrag(a.id);
                                }}
                                onDragEnd={() => {
                                    setDrag(null);
                                    setDrop(null);
                                }}
                                className="flex h-6 w-3 cursor-grab items-center justify-center text-ink-muted hover:text-ink"
                            >
                                <DotsGrid className="size-3" />
                            </span>
                            <span className="w-4 text-center text-[10.5px] tabular-nums text-ink-muted" title={nested ? (a.trigger === "with" ? "With previous" : "After previous") : "Click step"}>
                                {nested ? (a.trigger === "with" ? "=" : "→") : a.trigger === "click" ? step : ""}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(expanded ? null : a.id);
                                    if (target) editor.set({ selection: [target.id] });
                                }}
                                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                            >
                                <span className="truncate">{target?.name ?? "Missing layer"}</span>
                                <span className="shrink-0 text-ink-muted">{EFFECTS.find((e) => e.id === a.effect)?.label}{a.exit ? " out" : ""}</span>
                            </button>
                            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => write(anims.map((x, k) => (k === i - 1 ? a : k === i ? (anims[i - 1] as ObjectAnimation) : x)))} className="rounded p-0.5 text-ink-muted hover:text-ink disabled:opacity-30"><ArrowUp className="size-3" /></button>
                            <button type="button" aria-label="Remove animation" onClick={() => write(anims.filter((x) => x.id !== a.id))} className="rounded p-0.5 text-ink-muted hover:text-ink"><Trash01 className="size-3" /></button>
                        </div>
                        {expanded && (
                            <div className="space-y-1.5 p-1.5">
                                <div className="flex gap-1.5">
                                    <Select aria-label="Effect" value={a.effect} onChange={(e) => patch(a.id, { effect: e.target.value as AnimEffect })} className={field}>
                                        {EFFECTS.filter((e) => e.id !== "typewriter" || target?.type === "text").map((e) => (
                                            <option key={e.id} value={e.id}>{e.label}</option>
                                        ))}
                                    </Select>
                                    <Select aria-label="Trigger" value={a.trigger} onChange={(e) => patch(a.id, { trigger: e.target.value as AnimTrigger })} className={field}>
                                        {TRIGGERS.map((t) => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </Select>
                                </div>
                                <Select aria-label="Animate in or out" value={a.exit ? "out" : "in"} onChange={(e) => patch(a.id, { exit: e.target.value === "out" })} className={`${field} w-full`}>
                                    <option value="in">Animate in</option>
                                    <option value="out">Animate out</option>
                                </Select>
                                {a.effect === "slide" && (
                                    <Select aria-label="Animation direction" value={a.direction ?? "up"} onChange={(e) => patch(a.id, { direction: e.target.value as SlideDirection })} className={`${field} w-full`}>
                                        {DIRECTIONS.map((d) => (
                                            <option key={d} value={d}>From {d === "left" ? "right" : d === "right" ? "left" : d === "up" ? "below" : "above"}</option>
                                        ))}
                                    </Select>
                                )}
                                <div className="flex gap-1.5">
                                    <NumberInput label="Delay" value={a.delay} suffix="ms" onChange={(v) => patch(a.id, { delay: v })} />
                                    {a.effect !== "appear" && <NumberInput label="Time" value={a.duration} suffix="ms" onChange={(v) => patch(a.id, { duration: v })} />}
                                </div>
                            </div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

const EFFECTS: { id: AnimEffect; label: string }[] = [
    { id: "appear", label: "Appear" },
    { id: "fade", label: "Fade" },
    { id: "slide", label: "Slide" },
    { id: "scale", label: "Scale" },
    { id: "rise", label: "Rise" },
    { id: "typewriter", label: "Typewriter" },
];
const TRIGGERS: { id: AnimTrigger; label: string }[] = [
    { id: "click", label: "On click" },
    { id: "with", label: "With previous" },
    { id: "after", label: "After previous" },
];
const DIRECTIONS: SlideDirection[] = ["left", "right", "up", "down"];
const EASINGS: { id: SlideEasing; label: string }[] = [
    { id: "linear", label: "Linear" },
    { id: "ease-in", label: "Ease in" },
    { id: "ease-out", label: "Ease out" },
    { id: "ease-in-out", label: "Ease in and out" },
    { id: "gentle", label: "Gentle" },
    { id: "quick", label: "Quick" },
    { id: "bouncy", label: "Bouncy" },
    { id: "slow", label: "Slow" },
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AnimatePanel() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const id = useCurrentSlide();
    const slide = id ? doc.nodes[id] : undefined;
    const info = slideOf(slide);
    const picked = useSelectedSlides();
    const [open, setOpen] = useState<string | null>(null);
    const [transitionOpen, setTransitionOpen] = useState(false);
    if (!id || !slide || !info) return null;
    const transition = info.transition ?? DEFAULT_TRANSITION;
    // With several slides selected, the transition goes on all of them.
    const many = picked.length > 1;
    const setT = (patch: Partial<typeof transition>) => (many ? setTransitionAll({ ...transition, ...patch }, picked) : setTransition(id, { ...transition, ...patch }));
    const anims = info.animations ?? [];
    const write = (list: ObjectAnimation[]) => setAnimations(id, list);
    const patch = (aid: string, p: Partial<ObjectAnimation>) => write(anims.map((a) => (a.id === aid ? { ...a, ...p } : a)));
    const directional = ["slide-in", "slide-out", "push", "move-in", "move-out"].includes(transition.type);
    return (
        <>
            <Section title={many ? `Slide transition (${picked.length} slides)` : "Slide transition"} action={transition.type !== "none" ? <button type="button" onClick={() => setTransitionAll(transition)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-panel-hover hover:text-ink">Apply to all</button> : undefined}>
                {/* The transition as an outlined card; pressing it opens it in place (its header tinted
                    in the slides accent) with the Style dropdown and the rest of the settings. */}
                <div className="w-[208px] overflow-hidden rounded-[5px] border" style={{ borderColor: transitionOpen ? SLIDES_ORANGE : "var(--color-panel-border)" }}>
                    <button
                        type="button"
                        aria-expanded={transitionOpen}
                        aria-label={`Slide transition: ${TRANSITIONS.find((t) => t.id === transition.type)?.label ?? "None"}`}
                        onClick={() => setTransitionOpen(!transitionOpen)}
                        className={`flex h-8 w-full items-center gap-2 px-2.5 text-left text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${transitionOpen ? "" : "hover:bg-panel-hover"}`}
                        style={transitionOpen ? { background: "rgba(242, 78, 30, 0.42)", borderBottom: `1px solid ${SLIDES_ORANGE}` } : undefined}
                    >
                        <SlidesModeIcon className="size-4 shrink-0" />
                        {TRANSITIONS.find((t) => t.id === transition.type)?.label ?? "None"}
                    </button>
                    {transitionOpen && (
                        <div className="space-y-2 px-4 py-3">
                            <div className="flex h-6 items-center justify-between">
                                <span className="text-[11px] text-ink">Style</span>
                                <Select aria-label="Transition" value={transition.type} onChange={(e) => setT({ type: e.target.value as typeof transition.type })} className="h-6 w-[115px] rounded-[5px] border border-panel-border px-2 text-[11px] text-ink">
                                    <option value="none">None</option>
                                    <optgroup label="">
                                        {TRANSITIONS.filter((t) => t.id !== "none").map((t) => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                </Select>
                            </div>
                        {transition.type !== "none" && (
                            <>
                                {directional && (
                                    <div className="flex gap-1" role="group" aria-label="Direction">
                                        {DIRECTIONS.map((d) => (
                                            <button key={d} type="button" aria-pressed={transition.direction === d} onClick={() => setT({ direction: d })} className={`h-7 flex-1 rounded-md ${transition.direction === d ? "bg-panel-hover text-ink" : "bg-field text-ink-muted hover:text-ink"}`}>
                                                {cap(d)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-1.5">
                                    <Select aria-label="Easing" value={transition.easing} onChange={(e) => setT({ easing: e.target.value as SlideEasing })} className={field}>
                                        {EASINGS.map((e) => (
                                            <option key={e.id} value={e.id}>{e.label}</option>
                                        ))}
                                    </Select>
                                    <NumberInput label="" value={transition.duration} suffix="ms" onChange={(v) => setT({ duration: v })} />
                                </div>
                                <div className="flex gap-1.5">
                                    <Select aria-label="Transition timing" value={transition.after == null ? "click" : "after"} onChange={(e) => setT({ after: e.target.value === "after" ? 2000 : null })} className={field}>
                                        <option value="click">On click</option>
                                        <option value="after">After delay</option>
                                    </Select>
                                    {transition.after != null && <NumberInput label="" value={transition.after} suffix="ms" onChange={(v) => setT({ after: v })} />}
                                </div>
                                {!many && <SlidePreview id={id} what="transition" />}
                            </>
                        )}
                        </div>
                    )}
                </div>
            </Section>
            <Section
                title="Object animations"
                action={
                    <button
                        type="button"
                        aria-label="Add animation"
                        title={selection.length ? "Animate the selection" : "Select layers on the slide to animate them"}
                        disabled={!selection.length}
                        onClick={() => addAnimation(id, selection)}
                        className="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40"
                    >
                        <Plus className="size-3.5" />
                    </button>
                }
            >
                {anims.length === 0 && <div className="text-[11px] leading-4 text-ink-muted">Select an object on the slide, then click the add button to animate it.</div>}
                <AnimationList anims={anims} write={write} open={open} setOpen={setOpen} patch={patch} />
                {anims.length > 0 && <SlidePreview id={id} what="animations" />}
            </Section>
        </>
    );
}

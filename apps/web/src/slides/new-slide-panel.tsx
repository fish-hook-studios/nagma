import { ChevronLeft, ChevronRight, SearchSm, X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { applyCommand } from "../engine/commands";
import { editor, useEditor } from "../engine/store";
import type { NagmaDocument } from "../engine/types";
import { addAllLayouts, addSlide, chooseTemplate, setPublishedTemplate } from "./actions";
import { LAYOUTS, THEMES, addSlideCommands, createSlidesDocument, deckOf, templatesOf, themeOf } from "./model";
import { paintSlideCanvas } from "./render";
import { slides, useCurrentSlide, useSlides } from "./state";
import type { DeckTheme, SlideLayout } from "./types";

// New slide and the template picker, as the reference shows them: one 408-wide panel over the
// canvas's left edge, from under the top of the canvas down to the toolbar. The layouts view shows
// a template's slide layouts as two columns of pictures (click one to add it, or Add all slides);
// its back button goes to the templates (search, In this file, Basic, More), and picking one there
// shows its layouts. A new deck opens on the templates; closing the panel starts from scratch.

const previews = new Map<string, { doc: NagmaDocument; id: string }>();

// A deck of one slide in `layout` on `theme`, drawn for the pictures (kept per template and layout).
function previewOf(theme: DeckTheme, layout: SlideLayout): { doc: NagmaDocument; id: string } {
    const key = `${JSON.stringify(theme)}|${layout}`;
    const hit = previews.get(key);
    if (hit) return hit;
    const base = createSlidesDocument("Preview");
    const made = addSlideCommands(base, layout, null, theme);
    const out = { doc: applyCommand(base, { type: "batch", commands: made.commands }), id: made.id };
    if (previews.size > 200) previews.clear();
    previews.set(key, out);
    return out;
}

function LayoutPicture({ theme, layout, width }: { theme: DeckTheme; layout: SlideLayout; width: number }) {
    const ref = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const { doc, id } = previewOf(theme, layout);
        paintSlideCanvas(canvas, doc, id, width);
    }, [theme, layout, width]);
    return <canvas ref={ref} className="block" style={{ width, height: (width * 9) / 16 }} />;
}

const TILE = "block overflow-hidden rounded-[4px] border border-[#414141] outline-none hover:border-ink-subtle focus-visible:ring-2 focus-visible:ring-brand-500 [:root[data-theme=light]_&]:border-panel-border";
const OUTLINED = "flex h-6 shrink-0 items-center rounded-[5px] border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500";

export function NewSlidePanel() {
    const state = useSlides((s) => s.newSlide);
    const fresh = useEditor((s) => Boolean(s.doc.slides && deckOf(s.doc).picker && !s.readOnly));
    const readOnly = useEditor((s) => s.readOnly);
    const ref = useRef<HTMLDivElement | null>(null);
    const view = state ?? (fresh ? { view: "templates" as const } : null);
    const close = () => {
        if (editor.get().doc.slides && deckOf(editor.get().doc).picker) chooseTemplate(null);
        slides.set({ newSlide: null });
    };
    // Escape or a press outside closes it.
    useEffect(() => {
        if (!view) return;
        const key = (e: KeyboardEvent) => e.key === "Escape" && close();
        const press = (e: PointerEvent) => {
            const t = e.target as Element | null;
            if (ref.current?.contains(t as Node) || t?.closest?.("[data-new-slide-trigger],[role=dialog],[role=menu]")) return;
            close();
        };
        window.addEventListener("keydown", key, true);
        window.addEventListener("pointerdown", press, true);
        return () => {
            window.removeEventListener("keydown", key, true);
            window.removeEventListener("pointerdown", press, true);
        };
    });
    if (!view || readOnly) return null;
    return (
        <div ref={ref} role="dialog" aria-label={view.view === "layouts" ? "New slide" : "Templates"} className="absolute top-3 bottom-[72px] left-[11px] z-30 flex w-[408px] flex-col overflow-hidden rounded-[13px] bg-panel text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.3)]">
            {view.view === "layouts" ? <Layouts themeId={view.themeId} after={view.after} onClose={close} /> : <Templates after={view.after} onClose={close} />}
        </div>
    );
}

function Layouts({ themeId, after, onClose }: { themeId?: string; after?: string | null; onClose: () => void }) {
    const doc = useEditor((s) => s.doc);
    const current = useCurrentSlide();
    const own = themeOf(doc, current);
    const all = [...templatesOf(doc), ...THEMES];
    const theme = (themeId ? all.find((t) => t.id === themeId) : null) ?? own;
    const deckTheme = deckOf(doc).theme.id;
    const where = after === undefined ? current : after;
    const add = (layout: SlideLayout) => {
        addSlide(layout, where, theme.id === deckTheme ? undefined : theme);
        onClose();
    };
    return (
        <>
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-panel-border pr-2 pl-2">
                <button type="button" aria-label="Templates" title="Templates" onClick={() => slides.set({ newSlide: { view: "templates", after } })} className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                    <ChevronLeft className="size-4" />
                </button>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="text-ink-muted">Templates / </span>
                    <span className="font-medium">{theme.name}</span>
                </span>
                <button
                    type="button"
                    onClick={() => {
                        addAllLayouts(theme, where);
                        onClose();
                    }}
                    className={OUTLINED}
                >
                    Add all slides
                </button>
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-[14px] overflow-y-auto p-[15px]" aria-label="Slide layouts">
                {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" aria-label={l.label} title={l.label} onClick={() => add(l.id)} className={TILE}>
                        <LayoutPicture theme={theme} layout={l.id} width={180} />
                    </button>
                ))}
            </div>
        </>
    );
}

function Templates({ after, onClose }: { after?: string | null; onClose: () => void }) {
    const doc = useEditor((s) => s.doc);
    const fresh = deckOf(doc).picker;
    const published = Boolean(deckOf(doc).template);
    const [query, setQuery] = useState("");
    const inFile = templatesOf(doc);
    const q = query.trim().toLowerCase();
    const match = (t: DeckTheme) => !q || t.name.toLowerCase().includes(q);
    const basic = THEMES.filter((t) => t.id === "light" || t.id === "dark");
    const more = THEMES.filter((t) => !basic.includes(t));
    const groups = [
        { name: fresh ? "Recents" : "In this file", items: (fresh ? basic : inFile).filter(match) },
        { name: "Basic", items: basic.filter(match) },
        { name: "More", items: more.filter(match) },
    ].filter((g) => g.items.length);
    const pick = (theme: DeckTheme) => {
        // A new deck takes the template; then its layouts show, to add more slides.
        if (deckOf(editor.get().doc).picker) chooseTemplate(theme);
        slides.set({ newSlide: { view: "layouts", themeId: theme.id, after } });
    };
    return (
        <>
            <div className="flex h-10 shrink-0 items-center gap-2 px-2">
                <label className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] border border-panel-border px-2 focus-within:border-[#F24E1E]">
                    <SearchSm className="size-3.5 shrink-0 text-ink-muted" />
                    <input autoFocus aria-label="Search templates" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-subtle" />
                </label>
                {fresh && (
                    <button type="button" aria-label="Start from scratch" title="Start from scratch" onClick={onClose} className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                        <X className="size-4" />
                    </button>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-panel-border px-[15px] pb-4">
                {groups.map((g, gi) => (
                    <section key={g.name} aria-label={g.name}>
                        <div className="flex h-10 items-center justify-between pt-1">
                            <span className="flex items-center gap-1 text-[13px] font-medium">
                                {g.name}
                                {g.name === "More" && <ChevronRight className="size-3.5 text-ink-muted" />}
                            </span>
                            {gi === 0 && (
                                <button type="button" onClick={() => setPublishedTemplate(!published)} className={OUTLINED}>
                                    {published ? "Unpublish template" : "Publish template"}
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-[14px] gap-y-3 pt-1">
                            {g.items.map((t) => (
                                <button key={`${g.name}-${t.id}`} type="button" aria-label={`${t.name} template`} onClick={() => pick(t)} className="flex flex-col gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                    <span className={TILE}>
                                        <LayoutPicture theme={t} layout="title" width={180} />
                                    </span>
                                    <span className="truncate text-[11px] text-ink">{t.name}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
                {groups.length === 0 && <p className="py-6 text-center text-[11px] text-ink-muted">No templates match.</p>}
                <button type="button" onClick={() => slides.set({ libraryOpen: true })} className={`${OUTLINED} mt-4 w-full justify-center`}>
                    Templates from your other decks…
                </button>
            </div>
        </>
    );
}

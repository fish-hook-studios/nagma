import { useEffect, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { listFiles, loadFileDocument } from "../engine/files";
import { useEditor } from "../engine/store";
import { applyTheme, setSlideTemplate } from "./actions";
import { THEMES, deckOf, templatesOf } from "./model";
import { slides, useSelectedSlides, useSlides } from "./state";
import type { DeckTheme } from "./types";

// Shown over a new deck: pick a template style (colours and fonts) and, if wanted, a slide of
// every layout in it, or start from scratch. Clicking outside starts from scratch too.

function TemplateCard({ theme, onPick, badge }: { theme: DeckTheme; onPick: () => void; badge?: string }) {
    return (
        <button type="button" onClick={onPick} aria-label={`${theme.name} template`} className="group flex flex-col gap-2 rounded-xl p-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-brand-500">
            <span className="flex aspect-video w-full flex-col justify-center gap-2 overflow-hidden rounded-lg border border-white/10 px-5" style={{ background: theme.background }}>
                <span className="truncate text-[20px] leading-tight" style={{ color: theme.text, fontFamily: theme.headingFont, fontWeight: theme.headingWeight }}>Slide Deck Title</span>
                <span className="truncate text-[11px]" style={{ color: theme.text, fontFamily: theme.bodyFont }}>This is just the beginning of something big.</span>
            </span>
            <span className="flex items-center justify-between px-0.5 text-[12px] text-ink">
                {theme.name}
                <span className="text-[11px] text-ink-muted">{badge ?? theme.headingFont}</span>
            </span>
        </button>
    );
}

// Browse templates: the built-in ones and those of the other slide decks you have (your own and
// the ones shared with you). A template picked here goes on the selected slides, or on every
// slide; it joins this deck's templates either way.
export function TemplateLibrary() {
    const open = useSlides((s) => s.libraryOpen);
    const close = () => slides.set({ libraryOpen: false });
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <AriaModal className="max-h-[86vh] w-[760px] overflow-y-auto rounded-2xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="Templates" className="p-6 outline-none">{open && <LibraryBody close={close} />}</AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function LibraryBody({ close }: { close: () => void }) {
    const fileId = useEditor((s) => s.fileId);
    const doc = useEditor((s) => s.doc);
    const picked = useSelectedSlides();
    const [tab, setTab] = useState<"built-in" | "files">("built-in");
    const [everySlide, setEverySlide] = useState(false);
    const [found, setFound] = useState<{ file: string; templates: DeckTheme[]; published: boolean }[] | null>(null);
    useEffect(() => {
        if (tab !== "files" || found) return;
        let live = true;
        // The list is read here, once per scan: as a dependency it was a new array each render,
        // so any change to the open deck restarted the scan and it could never finish.
        const files = listFiles().filter((f) => f.kind === "slides" && !f.trashed && f.id !== fileId);
        void (async () => {
            const out: { file: string; templates: DeckTheme[]; published: boolean }[] = [];
            for (const f of files.slice(0, 40)) {
                if (!live) return;
                const other = await loadFileDocument(f.id).catch(() => null);
                if (other?.slides) out.push({ file: f.name || "Untitled", templates: templatesOf(other), published: Boolean(deckOf(other).template) });
            }
            // Decks published as templates first.
            if (live) setFound(out.sort((a, b) => Number(b.published) - Number(a.published)));
        })();
        return () => {
            live = false;
        };
    }, [tab, found, fileId]);
    const use = (theme: DeckTheme) => {
        if (everySlide) applyTheme(theme);
        else setSlideTemplate(picked, theme);
        close();
    };
    const inFile = templatesOf(doc).map((t) => t.id);
    return (
        <>
            <div className="mb-1 flex items-center justify-between">
                <div className="text-[16px] font-semibold">Templates</div>
                <div role="tablist" aria-label="Template source" className="flex gap-1">
                    {(["built-in", "files"] as const).map((t) => (
                        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${tab === t ? "bg-field text-ink" : "text-ink-muted hover:text-ink"}`}>
                            {t === "built-in" ? "Built in" : "From your decks"}
                        </button>
                    ))}
                </div>
            </div>
            <p className="mb-5 text-[12px] text-ink-muted">A template brings its colours, fonts, text styles and layouts. It goes on {everySlide ? "every slide" : picked.length > 1 ? `the ${picked.length} selected slides` : "this slide"}.</p>
            {tab === "built-in" ? (
                <div className="grid grid-cols-3 gap-3">
                    {THEMES.map((theme) => (
                        <TemplateCard key={theme.id} theme={theme} onPick={() => use(theme)} badge={inFile.includes(theme.id) ? "In this file" : undefined} />
                    ))}
                </div>
            ) : !found ? (
                <p className="py-10 text-center text-[12px] text-ink-muted">Looking through your slide decks…</p>
            ) : !found.length ? (
                <p className="py-10 text-center text-[12px] text-ink-muted">No other slide decks yet. Templates from decks you make or that are shared with you show here.</p>
            ) : (
                found.map((f, i) => (
                    <div key={`${f.file}${i}`} className="mb-5">
                        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
                            {f.file}
                            {f.published && <span className="rounded bg-field px-1.5 text-[10px] font-medium text-ink-muted">Published template</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {f.templates.map((theme) => (
                                <TemplateCard key={theme.id} theme={theme} onPick={() => use(theme)} />
                            ))}
                        </div>
                    </div>
                ))
            )}
            <label className="mt-5 flex items-center gap-2 border-t border-panel-border pt-4 text-[12px]">
                <input type="checkbox" checked={everySlide} onChange={(e) => setEverySlide(e.target.checked)} className="accent-brand-500" />
                <span>Use for every slide</span>
            </label>
        </>
    );
}

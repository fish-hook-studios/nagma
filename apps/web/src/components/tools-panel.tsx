import { ChevronDown, FilterLines, SearchSm, Users01 } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { booleanSelection, flattenSelection, outlineStroke, viewCenter } from "../engine/actions";
import { tidyUp } from "../engine/arrange";
import { exportLayers } from "../engine/export";
import { pickFigFile } from "../engine/files";
import { pickImages } from "../engine/images";
import { placeSampleMagazine } from "../engine/layout-import";
import { openActions } from "../engine/modes";
import { layerRoots } from "../engine/page";
import { openPdfEditor, pdfPaint } from "../engine/pdf";
import { firstImagePaint, openPhotoEditor } from "../engine/photo";
import { editor, useEditor } from "../engine/store";
import { pickPluginManifest } from "../engine/plugins";
import { MenuRow } from "./left-sidebar";
import { PluginsSection, WidgetsSection } from "./plugins-ui";
import { userStorage } from "../engine/user-storage";

// Tools: the built-in tools and engines, searchable, with the ones you used last on top.
interface ToolItem {
    id: string;
    name: string;
    source: "Built-in";
    category: "Edit" | "Import" | "Export" | "Generate";
    tint: string;
    glyph: string;
    run: () => void;
    ready: () => boolean;
}

const RECENTS_KEY = "nagma.tools.recents.v1";
function readRecents(): string[] {
    try {
        return JSON.parse(userStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}

export function ToolsPanel() {
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    const [query, setQuery] = useState("");
    const [source, setSource] = useState<string | null>(null);
    const [category, setCategory] = useState<string | null>(null);
    const [recents, setRecents] = useState<string[]>(readRecents);
    const single = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;

    const tools = useMemo<ToolItem[]>(
        () => [
            { id: "photo", name: "Photo adjustments", source: "Built-in", category: "Edit", tint: "#1F6F5B", glyph: "◐", run: () => single && openPhotoEditor(single.id), ready: () => Boolean(single && firstImagePaint(single) >= 0) },
            { id: "pdf", name: "PDF pages", source: "Built-in", category: "Edit", tint: "#8B2E2E", glyph: "▤", run: () => single && openPdfEditor(single.id), ready: () => Boolean(single && pdfPaint(single)) },
            { id: "tidy", name: "Tidy up", source: "Built-in", category: "Edit", tint: "#394760", glyph: "⊞", run: () => tidyUp(), ready: () => selection.length > 1 },
            { id: "union", name: "Boolean union", source: "Built-in", category: "Edit", tint: "#394760", glyph: "◉", run: () => booleanSelection("union"), ready: () => selection.length > 1 },
            { id: "flatten", name: "Flatten to vector", source: "Built-in", category: "Edit", tint: "#394760", glyph: "✎", run: flattenSelection, ready: () => selection.length > 0 },
            { id: "outline", name: "Outline stroke", source: "Built-in", category: "Edit", tint: "#394760", glyph: "◯", run: outlineStroke, ready: () => selection.length > 0 },
            { id: "fig", name: "Import a file", source: "Built-in", category: "Import", tint: "#5B6CFF", glyph: "⤓", run: pickFigFile, ready: () => true },
            { id: "pages", name: "Import PDF or InDesign", source: "Built-in", category: "Import", tint: "#6D4AFF", glyph: "⤓", run: () => pickImages(viewCenter), ready: () => true },
            { id: "sample", name: "Sample magazine", source: "Built-in", category: "Generate", tint: "#6D4AFF", glyph: "▣", run: () => void placeSampleMagazine(viewCenter()).catch(() => editor.notify("Couldn't open the sample.")), ready: () => true },
            { id: "motion", name: "Export animation (MP4, GIF, Lottie)", source: "Built-in", category: "Export", tint: "#B45309", glyph: "▶", run: () => { const s = editor.get(); void exportLayers(s.doc, s.selection.length ? s.selection : layerRoots(s.doc), "mp4", 1).catch((e) => editor.notify(String(e?.message ?? e))); }, ready: () => true },
            { id: "video", name: "Video fills and sequences", source: "Built-in", category: "Edit", tint: "#7C2D12", glyph: "▦", run: () => editor.notify("Add a video fill from the Fill popover (Video), or make a Video file from Home."), ready: () => true },
            { id: "actions", name: "All actions (⌘K)", source: "Built-in", category: "Edit", tint: "#394760", glyph: "⌘", run: openActions, ready: () => true },
        ],
        [selection, single],
    );

    const run = (t: ToolItem) => {
        const next = [t.id, ...recents.filter((r) => r !== t.id)].slice(0, 6);
        setRecents(next);
        try {
            userStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        } catch {
            // Fine.
        }
        t.run();
    };

    const q = query.trim().toLowerCase();
    const filtered = tools.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!source || t.source === source) && (!category || t.category === category));
    const recentTools = recents.map((id) => filtered.find((t) => t.id === id)).filter((t): t is ToolItem => Boolean(t));
    const suggested = filtered.filter((t) => !recents.includes(t.id));
    const chip = "flex h-8 items-center gap-1.5 rounded-md border border-panel-border px-2 text-ink outline-none hover:bg-panel-hover";

    const row = (t: ToolItem) => (
        <button key={t.id} type="button" disabled={!t.ready()} onClick={() => run(t)} className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left hover:bg-panel-hover disabled:opacity-40">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[16px] text-white" style={{ background: t.tint }}>
                {t.glyph}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px]">{t.name}</span>
                <span className="flex items-center gap-1.5 text-ink-muted">
                    <span>{t.category}</span>
                    <span className="text-ink-subtle">|</span>
                    <Users01 className="size-3" />
                    <span>By {t.source}</span>
                </span>
            </span>
        </button>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between px-4">
                <span className="text-[13px] font-semibold">Tools</span>
                <AriaMenuTrigger>
                    <AriaButton className="flex h-7 items-center gap-1 rounded-md border border-panel-border px-2 text-ink outline-none hover:bg-panel-hover">
                        Create <ChevronDown className="size-3" />
                    </AriaButton>
                    <AriaPopover placement="bottom end" className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            className="outline-none"
                            onAction={(k) => {
                                if (String(k) === "actions") openActions();
                                else if (String(k) === "plugin") pickPluginManifest();
                                else editor.notify("Shaders run inside the engines; custom shaders aren't supported yet.");
                            }}
                        >
                            <MenuRow id="plugin" label="Import plugin from manifest…" />
                            <MenuRow id="shader" label="New shader…" />
                            <MenuRow id="actions" label="Browse actions (⌘K)" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>
            <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-panel-border bg-panel px-2 text-ink-muted focus-within:border-brand-500">
                    <SearchSm className="size-4 shrink-0" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all tools" aria-label="Search all tools" onKeyDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-subtle" />
                </label>
                <AriaButton aria-label="Sort" onPress={() => setRecents([])} className="flex size-8 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <FilterLines className="size-4" />
                </AriaButton>
            </div>
            <div className="flex shrink-0 gap-2 px-3 pb-3">
                <AriaMenuTrigger>
                    <AriaButton className={chip}>
                        <Users01 className="size-3.5 text-ink-muted" /> {source ?? "Source"} <ChevronDown className="size-3" />
                    </AriaButton>
                    <AriaPopover placement="bottom start" className="w-44 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" onAction={(k) => setSource(String(k) === "all" ? null : String(k))}>
                            <MenuRow id="all" label="All sources" checked={source === null} />
                            {["Built-in"].map((s) => (
                                <MenuRow key={s} id={s} label={s} checked={source === s} />
                            ))}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
                <AriaMenuTrigger>
                    <AriaButton className={chip}>
                        ☰ {category ?? "Category"} <ChevronDown className="size-3" />
                    </AriaButton>
                    <AriaPopover placement="bottom start" className="w-40 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu className="outline-none" onAction={(k) => setCategory(String(k) === "all" ? null : String(k))}>
                            <MenuRow id="all" label="All categories" checked={category === null} />
                            {["Edit", "Import", "Export", "Generate"].map((c) => (
                                <MenuRow key={c} id={c} label={c} checked={category === c} />
                            ))}
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {recentTools.length > 0 && (
                    <>
                        <div className="px-2 pb-1 text-ink-muted">Recents</div>
                        {recentTools.map(row)}
                    </>
                )}
                <PluginsSection query={query} />
                <WidgetsSection query={query} />
                <div className="px-2 pt-2 pb-1 text-ink-muted">Suggested</div>
                {suggested.map(row)}
                {filtered.length === 0 && <p className="px-2 py-3 text-ink-muted">No tools match.</p>}
            </div>
        </div>
    );
}

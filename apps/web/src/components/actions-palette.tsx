import { ImagePlus, SearchSm } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { createInstance, viewCenter } from "../engine/actions";
import { reusableAssets } from "../engine/components";
import { exportLayers } from "../engine/export";
import { pickImages } from "../engine/images";
import { MENU_ACTIONS, actionEnabled, actionLabel, menuPaths } from "../engine/menu-actions";
import { layerRoots } from "../engine/page";
import { openPdfEditor } from "../engine/pdf";
import { openPhotoEditor } from "../engine/photo";
import { isWidget, pluginCommands, pluginStore, runPlugin, runsIn } from "../engine/plugins";
import { insertWidget } from "../engine/widgets";
import { editor, useEditor } from "../engine/store";
import type { Tool } from "../engine/types";
import { ComponentIcon } from "./component-icons";
import { userStorage } from "../engine/user-storage";

// Actions (⌘K): one search box over every tool and command, like a design tool's quick actions.
interface Action {
    id: string;
    label: string;
    group: string;
    shortcut?: string;
    tab: "actions" | "assets" | "plugins";
    keywords?: string;
    run: () => void;
}

const RECENTS_KEY = "nagma.actions.recents.v1";
function readRecents(): string[] {
    try {
        return JSON.parse(userStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}
function remember(id: string) {
    try {
        userStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...readRecents().filter((r) => r !== id)].slice(0, 5)));
    } catch {
        // Fine.
    }
}

const TOOLS: [Tool, string, string?][] = [
    ["move", "Move", "V"],
    ["hand", "Hand tool", "H"],
    ["scale", "Scale", "K"],
    ["frame", "Frame", "F"],
    ["section", "Section", "⇧S"],
    ["slice", "Slice", "S"],
    ["rect", "Rectangle", "R"],
    ["line", "Line", "L"],
    ["arrow", "Arrow", "⇧ L"],
    ["ellipse", "Ellipse", "O"],
    ["polygon", "Polygon"],
    ["star", "Star"],
    ["pen", "Pen", "P"],
    ["pencil", "Pencil", "⇧ P"],
    ["brush", "Brush", "B"],
    ["text", "Text", "T"],
    ["textpath", "Text on path"],
    ["comment", "Comment", "C"],
    ["annotation", "Annotation", "Y"],
    ["measure", "Measurement", "⇧M"],
    ["eyedropper", "Eyedropper", "I"],
];

function actions(): Action[] {
    const s = editor.get();
    const has = s.selection.length > 0;
    const single = s.selection.length === 1 ? s.doc.nodes[s.selection[0] ?? ""] : undefined;
    const paths = menuPaths();
    const plugin = (id: string, label: string, group: string, run: () => void): Action => ({ id, label, group, run, tab: "plugins" });
    // AI: the agent works on the file (or the selection) from a prompt.
    const ask = (id: string, label: string, prompt: string): Action => ({ id, label, group: "AI", tab: "actions", keywords: "ai agent assistant generate", run: () => askAgent(prompt) });
    return [
        ask("ai-ask", "Ask the agent…", ""),
        ...(has ? [ask("ai-rename", "Rename layers", "Rename the selected layers to describe what they are."), ask("ai-layout", "Tidy into auto layout", "Put the selected layers into auto layout with even spacing.")] : []),
        ask("ai-draft", "Make a first draft…", "Make a first draft of "),
        ...TOOLS.map(([tool, label, shortcut]): Action => ({ id: `tool-${tool}`, label, group: "Tools", shortcut, tab: "actions", run: () => editor.set({ tool }) })),
        // Every main-menu command that can run now, from the shared action table.
        ...MENU_ACTIONS.filter((a) => a.id !== "actions" && actionEnabled(a, s)).map(
            (a): Action => ({ id: a.id, label: actionLabel(a, s), group: a.group === "Menu" ? "Menu" : a.group, shortcut: a.shortcut, tab: "actions", keywords: `${a.keywords ?? ""} ${paths.get(a.id) ?? ""}`, run: a.run }),
        ),
        // Assets: this file's components, inserted as instances.
        ...reusableAssets(s.doc).map((c): Action => ({ id: `asset-${c.id}`, label: c.name, group: "Components", tab: "assets", run: () => createInstance(c.id, viewCenter()) })),
        // Plugins & widgets: the built-in tools.
        plugin("photo", "Photo adjustments", "Image editing", () => openPhotoEditor(single?.id)),
        plugin("pdf", "PDF pages", "Documents", () => openPdfEditor(single?.id)),
        plugin("motion", "Export animation (MP4, GIF, Lottie)", "Export", () => void exportLayers(s.doc, has ? s.selection : layerRoots(s.doc), "mp4", 1).catch((e) => editor.notify(String(e?.message ?? e)))),
        // Widgets imported here: insert one in the middle of the view.
        ...pluginStore
            .get()
            .plugins.filter((p) => isWidget(p) && s.mode !== "dev")
            .map((p) => plugin(`widget-${p.id}`, p.manifest.name, "Widgets", () => void insertWidget(p.id, p.manifest.name))),
        // Plugins imported here (Development), each command on its own.
        ...pluginStore
            .get()
            .plugins.filter((p) => runsIn(p, s.mode === "dev" ? "inspect" : "design"))
            .flatMap((p): Action[] => {
                const commands = pluginCommands(p);
                if (!commands.length) return [plugin(`plugin-${p.id}`, p.manifest.name, "Development", () => runPlugin(p.id))];
                return commands.map((c) => plugin(`plugin-${p.id}-${c.command}`, `${p.manifest.name} › ${c.label}`, "Development", () => runPlugin(p.id, c.command)));
            }),
    ];
}

// Opens the Agents panel with the prompt typed in, ready to send or finish.
function askAgent(prompt: string) {
    editor.setPrefs({ leftPanel: "agents", leftPanelOpen: true });
    requestAnimationFrame(() => {
        const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask the agent"]');
        if (!field) return;
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        set?.call(field, prompt);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
        field.setSelectionRange(prompt.length, prompt.length);
    });
}

// Ranks a match: the label starting with the query first, then a word in it, then anywhere,
// then only the group, keywords or menu path.
function score(a: Action, q: string): number {
    const label = a.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/[\s/(]+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (`${a.group} ${a.keywords ?? ""}`.toLowerCase().includes(q)) return 3;
    return -1;
}

export function ActionsPalette() {
    const open = useEditor((s) => s.actionsOpen);
    // Mounted fresh each time it opens, so the search starts empty.
    return open ? <Palette /> : null;
}

function Palette() {
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<"all" | "assets" | "plugins">("all");
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const selected = useEditor((s) => s.selection.length);
    const setOpen = (open: boolean) => editor.set({ actionsOpen: open });

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // The list depends on what is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const all = useMemo(() => actions(), [selected]);
    const items = useMemo(() => {
        const q = query.trim().toLowerCase();
        const inTab = all.filter((a) => tab === "all" || a.tab === tab);
        if (!q) return inTab;
        return inTab
            .map((a, i) => ({ a, i, rank: score(a, q) }))
            .filter((x) => x.rank >= 0)
            .sort((x, y) => x.rank - y.rank || x.i - y.i)
            .map((x) => x.a);
    }, [all, query, tab]);
    // Without a search: Recents first, then every group under its heading. With one: a flat ranked list.
    const q = query.trim();
    const recents = q ? [] : readRecents().map((id) => items.find((a) => a.id === id)).filter((a): a is Action => Boolean(a));
    const sections: { title: string; items: Action[] }[] = [];
    if (q) sections.push({ title: "", items });
    else {
        if (recents.length) sections.push({ title: "Recents", items: recents });
        const groups = new Map<string, Action[]>();
        for (const a of items) if (!recents.includes(a)) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
        for (const [title, list] of groups) sections.push({ title, items: list });
    }
    const flat = sections.flatMap((s) => s.items);

    const choose = (action: Action) => {
        setOpen(false);
        remember(action.id);
        action.run();
    };
    const tabs: { id: typeof tab; label: string }[] = [
        { id: "all", label: "All" },
        { id: "assets", label: "Assets" },
        { id: "plugins", label: "Plugins & widgets" },
    ];
    let n = -1;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 pb-24" onMouseDown={() => setOpen(false)}>
            <div className="w-[520px] overflow-hidden rounded-2xl border border-panel-border bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
                <div className="p-2">
                    <label className="flex h-11 items-center gap-2 rounded-xl bg-field px-3 text-ink-muted">
                        <SearchSm className="size-4" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setIndex(0);
                            }}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Escape") setOpen(false);
                                else if (e.key === "ArrowDown") setIndex((i) => Math.min(flat.length - 1, i + 1));
                                else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
                                else if (e.key === "Enter" && flat[index]) choose(flat[index]);
                                else if (e.key === "Tab") {
                                    e.preventDefault();
                                    setTab((t) => (t === "all" ? "assets" : t === "assets" ? "plugins" : "all"));
                                }
                            }}
                            placeholder="Search"
                            aria-label="Search actions"
                            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-subtle"
                        />
                        <button type="button" aria-label="Place image or video" onClick={() => choose({ id: "place", label: "", group: "", tab: "actions", run: () => pickImages(viewCenter) })} className="flex size-7 items-center justify-center rounded-md border border-panel-border hover:bg-panel-hover hover:text-ink">
                            <ImagePlus className="size-4" />
                        </button>
                    </label>
                    <div className="mt-2 flex items-center gap-1 px-1">
                        {tabs.map((t) => (
                            <button key={t.id} type="button" onClick={() => { setTab(t.id); setIndex(0); }} className={`h-7 rounded-md px-2.5 text-[12px] ${tab === t.id ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="max-h-[46vh] overflow-y-auto px-2 pb-2">
                    {flat.length === 0 && <div className="px-3 py-4 text-ink-muted">{tab === "assets" ? "No components in this file yet. Select a frame and press ⌥⌘K." : "Nothing matches."}</div>}
                    {sections.map((section) => (
                        <div key={section.title || "results"}>
                            {section.title && <div className="px-3 pt-3 pb-1 text-[12px] text-ink-muted">{section.title}</div>}
                            {section.items.map((a) => {
                                n++;
                                const i = n;
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        onMouseEnter={() => setIndex(i)}
                                        onClick={() => choose(a)}
                                        className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] ${i === index ? "bg-panel-hover text-ink" : "text-ink"}`}
                                    >
                                        {a.tab === "assets" ? <ComponentIcon className="size-4 text-[#B67CFF]" /> : <span className="flex size-6 items-center justify-center rounded bg-field text-[10px] text-ink-muted">{a.group.slice(0, 1)}</span>}
                                        <span className="min-w-0 flex-1 truncate">{a.label}</span>
                                        {q && <span className="text-[11px] text-ink-subtle">{a.group}</span>}
                                        {a.shortcut && <span className="text-[11px] text-ink-subtle">{a.shortcut}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

import { ChevronDown, SearchSm, XClose } from "@untitledui/icons";
import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { FIND_KINDS, type FindKind, type FindResult, findLayers, replaceText, revealResult } from "../engine/find";
import { editor, useEditor } from "../engine/store";
import { closeFind, ui, useUi } from "../engine/ui-state";
import { MenuRow } from "./left-sidebar";
import { isReusable, layerIcon } from "./layer-kind";

// A line of text with the query picked out.
function Highlight({ text, query }: { text: string; query: string }) {
    const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
    if (at < 0 || !query.trim()) return <>{text}</>;
    // Keep the match in view in long text: start a little before it.
    const from = Math.max(0, at - 16);
    const end = at + query.trim().length;
    return (
        <>
            {from > 0 ? "…" : ""}
            {text.slice(from, at)}
            <mark className="rounded-sm bg-brand-500/30 text-ink">{text.slice(at, end)}</mark>
            {text.slice(end)}
        </>
    );
}

// Find and replace (⌘F) in the left panel: layer names and text, on this page or all pages, one
// kind of layer or all; results jump to the layer. Replace changes text content only.
export function FindPanel() {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const selection = useEditor((s) => s.selection);
    const replaceOpen = useUi((s) => s.findReplace);
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [allPages, setAllPages] = useState(false);
    const [kind, setKind] = useState<FindKind>("all");
    useEffect(() => ui.set({ findQuery: { query, allPages, kind } }), [query, allPages, kind]);
    const results = useMemo(() => findLayers(doc, query, { pageId: allPages ? null : pageId, kind }), [doc, query, allPages, pageId, kind]);
    const textResults = results.filter((r) => r.inText);
    const selectedText = textResults.filter((r) => selection.includes(r.id));
    const shown = results.slice(0, 500);
    const kindLabel = FIND_KINDS.find((k) => k.id === kind)?.label ?? "All layers";

    const replace = (which: FindResult[]) => {
        const count = replaceText(
            which.map((r) => r.id),
            query,
            replacement,
        );
        editor.notify(count ? `Replaced text in ${count} ${count === 1 ? "layer" : "layers"}.` : "Nothing to replace. Replace works on text layers.");
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-1.5 px-2 pb-2">
                <label className="flex h-7 items-center gap-1.5 rounded-md bg-field px-2 text-ink-muted focus-within:ring-1 focus-within:ring-brand-500">
                    <SearchSm className="size-3.5 shrink-0" />
                    <input
                        autoFocus
                        aria-label="Find"
                        placeholder="Find"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") closeFind();
                            if (e.key === "Enter" && shown[0]) revealResult(shown[0]);
                        }}
                        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle"
                    />
                    <button type="button" aria-label="Close find" onClick={closeFind} className="flex size-5 items-center justify-center rounded hover:bg-panel-hover hover:text-ink">
                        <XClose className="size-3" />
                    </button>
                </label>
                <div className="grid grid-cols-2 gap-0.5 rounded-md bg-field p-0.5">
                    {[false, true].map((all) => (
                        <button key={String(all)} type="button" onClick={() => setAllPages(all)} className={`h-6 rounded px-2 whitespace-nowrap ${allPages === all ? "bg-panel text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                            {all ? "All pages" : "This page"}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1">
                    <AriaMenuTrigger>
                        <AriaButton aria-label="Layer type" className="flex h-7 min-w-0 items-center gap-0.5 rounded-md px-1.5 text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                            <span className="truncate whitespace-nowrap">{kindLabel}</span>
                            <ChevronDown className="size-3 shrink-0 mr-0.5" />
                        </AriaButton>
                        <AriaPopover placement="bottom start" className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                            <AriaMenu aria-label="Layer type" className="outline-none" onAction={(k) => setKind(String(k) as FindKind)}>
                                {FIND_KINDS.map((k) => (
                                    <MenuRow key={k.id} id={k.id} label={k.label} checked={k.id === kind} />
                                ))}
                            </AriaMenu>
                        </AriaPopover>
                    </AriaMenuTrigger>
                    <div className="flex-1" />
                    <button type="button" onClick={() => ui.set({ findReplace: !replaceOpen })} className={`h-7 rounded-md px-1.5 whitespace-nowrap ${replaceOpen ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        Replace
                    </button>
                </div>
                {replaceOpen && (
                    <div className="space-y-1.5">
                        <input
                            aria-label="Replace with"
                            placeholder="Replace with"
                            value={replacement}
                            onChange={(e) => setReplacement(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Escape") closeFind();
                            }}
                            className="h-7 w-full rounded-md bg-field px-2 text-ink outline-none placeholder:text-ink-subtle focus:ring-1 focus:ring-brand-500"
                        />
                        <div className="flex gap-1">
                            <button type="button" disabled={!selectedText.length} onClick={() => replace(selectedText)} className="h-7 flex-1 rounded-md border border-panel-border hover:bg-panel-hover disabled:opacity-40">
                                Replace{selectedText.length ? ` (${selectedText.length})` : ""}
                            </button>
                            <button type="button" disabled={!textResults.length} onClick={() => replace(textResults)} className="h-7 flex-1 rounded-md bg-brand-500 font-medium text-white disabled:opacity-40">
                                Replace all
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {query.trim() && (
                    <div className="px-2 pb-1 text-ink-subtle">
                        {results.length === 0 ? "No results" : `${results.length} ${results.length === 1 ? "result" : "results"}`}
                        {results.length > shown.length ? ` (showing ${shown.length})` : ""}
                    </div>
                )}
                {shown.map((r, i) => {
                    const node = doc.nodes[r.id];
                    if (!node) return null;
                    const Icon = layerIcon(node);
                    const header = allPages && r.pageId !== shown[i - 1]?.pageId ? doc.nodes[r.pageId]?.name : null;
                    return (
                        <div key={r.id}>
                            {header && <div className="px-2 pt-2 pb-1 font-semibold text-ink-muted">{header}</div>}
                            <button
                                type="button"
                                onClick={(e) => revealResult(r, e.shiftKey || e.metaKey || e.ctrlKey)}
                                onPointerEnter={() => r.pageId === pageId && editor.set({ hoverId: r.id })}
                                onPointerLeave={() => editor.set({ hoverId: null })}
                                className={`flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left ${selection.includes(r.id) ? "bg-brand-100 text-ink" : "hover:bg-panel-hover"}`}
                            >
                                <Icon className={`mt-px size-3.5 shrink-0 ${isReusable(node) ? "text-[#B67CFF]" : "text-ink-subtle"}`} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{r.inName ? <Highlight text={node.name} query={query} /> : node.name}</span>
                                    {r.inText && node.text !== node.name && (
                                        <span className="block truncate text-ink-muted">
                                            <Highlight text={(node.text ?? "").replace(/\s+/g, " ")} query={query} />
                                        </span>
                                    )}
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

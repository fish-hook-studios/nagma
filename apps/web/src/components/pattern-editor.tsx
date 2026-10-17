import { AlignCenter, AlignLeft, AlignRight, SearchSm } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { editor, useEditor } from "../engine/store";
import type { Paint, PatternPaint, SceneNode } from "../engine/types";
import { NumberField } from "./number-field";
import { Select } from "./select";

// The Pattern paint's settings, like the reference's: the source layer, tile type, scale, spacing and
// horizontal alignment.

const TILE_LABELS: Record<PatternPaint["tile"], string> = {
    rectangular: "Rectangular grid",
    "horizontal-hex": "Horizontal hexagonal",
    "vertical-hex": "Vertical hexagonal",
};

const field = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";

export function PatternEditor({ paint, onChange, onPreview }: { paint: PatternPaint; onChange: (p: Paint) => void; onPreview: (p: Paint) => void }) {
    const source = useEditor((s) => s.doc.nodes[paint.sourceId]);
    const [choosing, setChoosing] = useState(!source);
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-ink-muted">Source</span>
                <button type="button" onClick={() => setChoosing(!choosing)} className={`${field} flex flex-1 items-center text-left`}>
                    <span className="min-w-0 flex-1 truncate">{source ? source.name : "Choose a layer"}</span>
                </button>
            </div>
            {choosing && (
                <SourcePicker
                    current={paint.sourceId}
                    onPick={(id) => {
                        onChange({ ...paint, sourceId: id });
                        setChoosing(false);
                    }}
                />
            )}
            <label className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-ink-muted">Tile type</span>
                <Select aria-label="Tile type" value={paint.tile} onChange={(e) => onChange({ ...paint, tile: e.target.value as PatternPaint["tile"] })} className={`${field} flex-1`}>
                    {(Object.keys(TILE_LABELS) as PatternPaint["tile"][]).map((t) => (
                        <option key={t} value={t}>
                            {TILE_LABELS[t]}
                        </option>
                    ))}
                </Select>
            </label>
            <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-ink-muted">Scale</span>
                <div className="flex-1">
                    <NumberField
                        label="⤢"
                        title="Tile scale"
                        suffix="%"
                        min={1}
                        max={10000}
                        value={Math.round(paint.scale * 100)}
                        onCommit={(v) => onChange({ ...paint, scale: v / 100 })}
                        onScrub={(v) => onPreview({ ...paint, scale: v / 100 })}
                        onScrubEnd={(v) => onChange({ ...paint, scale: v / 100 })}
                    />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-ink-muted">Spacing</span>
                <div className="grid flex-1 grid-cols-2 gap-1">
                    <NumberField label="↔" title="Horizontal spacing" value={paint.spacing.x} onCommit={(v) => onChange({ ...paint, spacing: { ...paint.spacing, x: v } })} onScrub={(v) => onPreview({ ...paint, spacing: { ...paint.spacing, x: v } })} onScrubEnd={(v) => onChange({ ...paint, spacing: { ...paint.spacing, x: v } })} />
                    <NumberField label="↕" title="Vertical spacing" value={paint.spacing.y} onCommit={(v) => onChange({ ...paint, spacing: { ...paint.spacing, y: v } })} onScrub={(v) => onPreview({ ...paint, spacing: { ...paint.spacing, y: v } })} onScrubEnd={(v) => onChange({ ...paint, spacing: { ...paint.spacing, y: v } })} />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-ink-muted">Alignment</span>
                <div className="flex flex-1 rounded-md bg-field p-0.5" role="radiogroup" aria-label="Pattern alignment">
                    {(
                        [
                            ["start", AlignLeft, "Left"],
                            ["center", AlignCenter, "Center"],
                            ["end", AlignRight, "Right"],
                        ] as const
                    ).map(([id, Icon, label]) => (
                        <button key={id} type="button" role="radio" aria-checked={paint.align === id} aria-label={label} title={label} onClick={() => onChange({ ...paint, align: id })} className={`flex h-6 flex-1 items-center justify-center rounded ${paint.align === id ? "bg-panel text-ink shadow-sm" : "text-ink-subtle hover:text-ink"}`}>
                            <Icon className="size-3.5" />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Layers on this page that can be a pattern's source (not the selection or what contains it).
function SourcePicker({ current, onPick }: { current: string; onPick: (id: string) => void }) {
    const doc = useEditor((s) => s.doc);
    const pageId = useEditor((s) => s.pageId);
    const selection = useEditor((s) => s.selection);
    const [query, setQuery] = useState("");
    const items = useMemo(() => {
        const blocked = new Set<string>();
        for (const id of selection) {
            let n: SceneNode | undefined = doc.nodes[id];
            while (n) {
                blocked.add(n.id);
                n = n.parentId ? doc.nodes[n.parentId] : undefined;
            }
        }
        const out: { node: SceneNode; depth: number }[] = [];
        const walk = (ids: string[], depth: number) => {
            for (const id of [...ids].reverse()) {
                const n = doc.nodes[id];
                if (!n || n.isSlice) continue;
                if (!blocked.has(n.id)) out.push({ node: n, depth });
                if (depth < 2) walk(n.children, depth + 1);
            }
        };
        walk(doc.nodes[pageId]?.children ?? [], 0);
        const q = query.trim().toLowerCase();
        return out.filter((it) => !q || it.node.name.toLowerCase().includes(q)).slice(0, 200);
    }, [doc, pageId, selection, query]);
    return (
        <div className="rounded-md border border-panel-border">
            <label className="flex h-6 items-center gap-1.5 border-b border-panel-border px-2 text-ink-muted">
                <SearchSm className="size-3.5" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find a layer" aria-label="Find a source layer" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
            </label>
            <div className="max-h-40 overflow-y-auto p-1">
                {items.length === 0 && <p className="px-1 py-2 text-center text-ink-muted">No layers to use</p>}
                {items.map(({ node, depth }) => (
                    <button
                        key={node.id}
                        type="button"
                        onClick={() => onPick(node.id)}
                        onMouseEnter={() => editor.set({ hoverId: node.id })}
                        onMouseLeave={() => editor.set({ hoverId: null })}
                        className={`flex h-6 w-full items-center rounded px-1 text-left hover:bg-panel-hover ${current === node.id ? "text-brand-500" : ""}`}
                        style={{ paddingLeft: 4 + depth * 12 }}
                    >
                        <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

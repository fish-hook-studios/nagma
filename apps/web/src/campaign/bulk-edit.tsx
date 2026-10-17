import { ChevronDown, ChevronLeft, ChevronRight, DotsGrid, Hash02, Image01, LayersThree01, Plus, Sliders02, Stars02, Type01, Upload01 } from "@untitledui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { MenuRow } from "../components/left-sidebar";
import { setVariant } from "../engine/actions";
import { aiError, aiRequestHeaders, keyNeeded, notifyKeyNeeded } from "../engine/ai-settings";
import { applyCommand } from "../engine/commands";
import { propValue, propsOf, setProperties, variantProps } from "../engine/components";
import { httpBase } from "../engine/server-url";
import { editor, useEditor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { collectionsOf } from "../engine/variables";
import { replaceImage } from "./actions";
import { openAssetMenu } from "./asset-menu";
import { AssetThumb } from "./left-panel";
import { ASSET_GAP, assetData, copyAsset, createCommands, duplicateAssets, executeArranged, fieldNamed, fieldValue, fieldValuePatch, fieldsOf, layerData, placeAsset, presetFor, rowsOf, SIZE_GROUPS, SIZE_PRESETS } from "./model";
import { resizeCommands } from "./resize";
import { ReviewBadge } from "./reviews";
import { campaign, useCampaign } from "./state";
import type { FieldKind } from "./types";

// Bulk edit: every asset as a spreadsheet row, grouped by the template it comes from, with a
// column for the size, each field the template opens up, each variable collection with modes and
// each component property of the instances inside. It works like a spreadsheet: click or use the
// arrow keys to move, ⇧ to select a range, Enter or typing to edit and Enter to confirm, drag the
// handle to fill, copy and paste blocks of cells (pasting more rows than there are adds assets),
// Delete to clear, ⌘D to duplicate rows, and drag the grip to reorder. The asset of the row in
// focus shows large on the right.

interface Group {
    root: SceneNode;
    assets: SceneNode[];
}

type CellKind = "size" | "text" | "image" | "color" | "select";

interface Column {
    key: string;
    label: string;
    kind: CellKind;
    icon: ReactNode;
    width: number;
    options?: (doc: NagmaDocument, asset: SceneNode) => { value: string; label: string }[];
    get(doc: NagmaDocument, asset: SceneNode): string;
    // Commands for a new value (null when the cell can't take it). `after` runs once they ran.
    set(doc: NagmaDocument, asset: SceneNode, value: string): { commands: Command[]; after?: () => void } | null;
    locked(doc: NagmaDocument, asset: SceneNode): boolean;
}

// Groups and their rows in the asset list's order (rows, then left to right), so reordering
// rows (the grip, Order, or the asset list) shows here too.
export function groupsOf(doc: NagmaDocument): Group[] {
    const byRoot = new Map<string, SceneNode[]>();
    const order: string[] = [];
    for (const asset of rowsOf(doc).flatMap((v) => v.assets)) {
        const data = assetData(asset);
        const source = data?.sourceId && doc.nodes[data.sourceId] ? data.sourceId : asset.id;
        if (!byRoot.has(source)) {
            byRoot.set(source, []);
            order.push(source);
        }
        byRoot.get(source)?.push(asset);
    }
    return order.flatMap((id) => {
        const root = doc.nodes[id];
        const assets = byRoot.get(id) ?? [];
        // The template itself leads its group.
        return root ? [{ root, assets: [root, ...assets.filter((a) => a.id !== root.id)] }] : [];
    });
}

// The instances inside an asset, in layer order (copies of a template line up by position).
function instancesOf(doc: NagmaDocument, assetId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        if (n.type === "instance") out.push(n);
        else for (const c of n.children) visit(c);
    };
    for (const c of doc.nodes[assetId]?.children ?? []) visit(c);
    return out;
}

const KIND_ICON: Record<FieldKind, ReactNode> = {
    text: <Type01 className="size-3.5 shrink-0" />,
    image: <Image01 className="size-3.5 shrink-0" />,
    color: <span className="size-3 shrink-0 rounded-full border border-ink-muted" />,
};

const widthFor = (label: string, min = 72) => Math.max(min, Math.min(170, label.length * 7 + 44));

function columnsOf(doc: NagmaDocument, group: Group): Column[] {
    const cols: Column[] = [
        {
            key: "size",
            label: "Asset size",
            kind: "size",
            icon: <Hash02 className="size-3.5 shrink-0" />,
            width: 115,
            get: (_d, a) => {
                const preset = presetFor(assetData(a)?.preset);
                return preset && preset.w === a.w && preset.h === a.h ? preset.id : "custom";
            },
            set: (d, a, value) => {
                const v = value.trim().toLowerCase();
                const id = presetFor(value)?.id ?? SIZE_PRESETS.find((p) => `${p.label} ${p.w}x${p.h}`.toLowerCase() === v || `${p.w}x${p.h}` === v)?.id;
                return id ? { commands: resizeCommands(d, a.id, id) } : null;
            },
            locked: () => false,
        },
    ];
    const seen = new Set<string>();
    for (const n of fieldsOf(doc, group.root.id)) {
        const f = layerData(n);
        if (!f || seen.has(f.field)) continue;
        seen.add(f.field);
        const { field, type } = f;
        cols.push({
            key: `field:${field}`,
            label: field,
            kind: type,
            icon: KIND_ICON[type],
            width: widthFor(field, type === "image" ? 96 : 72),
            get: (d, a) => {
                const node = fieldNamed(d, a.id, field);
                return node ? fieldValue(node, type) : "";
            },
            set: (d, a, value) => {
                const node = fieldNamed(d, a.id, field);
                if (!node || !layerData(node)) return null;
                if (type === "image" && value && !d.images[value]) return null;
                const patch = fieldValuePatch(node, type, type === "color" ? value.trim().toUpperCase() : value);
                return { commands: patch ? [{ type: "node.update", id: node.id, patch }] : [] };
            },
            locked: (d, a) => {
                const data = layerData(fieldNamed(d, a.id, field));
                return !data || (type === "color" ? data.locks.style : data.locks.content);
            },
        });
    }
    // Variable modes: one column per collection with more than one mode.
    for (const c of collectionsOf(doc).filter((x) => x.modes.length > 1)) {
        cols.push({
            key: `mode:${c.id}`,
            label: c.name,
            kind: "select",
            icon: <LayersThree01 className="size-3.5 shrink-0" />,
            width: widthFor(c.name, 96),
            options: () => [{ value: "", label: "Default" }, ...c.modes.map((m) => ({ value: m.id, label: m.name }))],
            get: (_d, a) => a.variableModes?.[c.id] ?? "",
            set: (_d, a, value) => {
                const mode = c.modes.find((m) => m.id === value || m.name.toLowerCase() === value.trim().toLowerCase());
                const next = { ...(a.variableModes ?? {}) };
                if (mode) next[c.id] = mode.id;
                else if (!value.trim() || value.trim().toLowerCase() === "default") delete next[c.id];
                else return null;
                return { commands: [{ type: "node.update", id: a.id, patch: { variableModes: next } }] };
            },
            locked: () => false,
        });
    }
    // Component properties of the template's instances, matched in copies by their place.
    instancesOf(doc, group.root.id).forEach((inst, index) => {
        const component = doc.nodes[inst.componentId ?? ""];
        const set = component?.parentId ? doc.nodes[component.parentId] : undefined;
        const instanceAt = (d: NagmaDocument, a: SceneNode) => instancesOf(d, a.id)[index];
        if (set?.type === "componentSet") {
            for (const [property, values] of setProperties(doc, set.id)) {
                const label = `${inst.name} ${property}`;
                cols.push({
                    key: `variant:${index}:${property}`,
                    label,
                    kind: "select",
                    icon: <DotsGrid className="size-3.5 shrink-0" />,
                    width: widthFor(label, 96),
                    options: () => values.map((v) => ({ value: v, label: v })),
                    get: (d, a) => {
                        const i = instanceAt(d, a);
                        return i ? (variantProps(d.nodes[i.componentId ?? ""]?.name ?? "")[property] ?? "") : "";
                    },
                    set: (d, a, value) => {
                        const i = instanceAt(d, a);
                        const v = values.find((x) => x.toLowerCase() === value.trim().toLowerCase());
                        return i && v ? { commands: [], after: () => setVariant(i.id, property, v) } : null;
                    },
                    locked: (d, a) => !instanceAt(d, a),
                });
            }
        }
        for (const prop of propsOf(doc, component).filter((p) => p.kind === "boolean" || p.kind === "text")) {
            const label = `${inst.name} ${prop.name}`;
            cols.push({
                key: `prop:${index}:${prop.id}`,
                label,
                kind: prop.kind === "boolean" ? "select" : "text",
                icon: <DotsGrid className="size-3.5 shrink-0" />,
                width: widthFor(label, 96),
                options:
                    prop.kind === "boolean"
                        ? () => [
                              { value: "true", label: "On" },
                              { value: "false", label: "Off" },
                          ]
                        : undefined,
                get: (d, a) => {
                    const i = instanceAt(d, a);
                    return i ? String(propValue(d, prop, i)) : "";
                },
                set: (_d, a, value) => {
                    const i = instanceAt(_d, a);
                    if (!i) return null;
                    let v: string | boolean = value;
                    if (prop.kind === "boolean") {
                        const t = value.trim().toLowerCase();
                        if (["true", "on", "yes", "1"].includes(t)) v = true;
                        else if (["false", "off", "no", "0"].includes(t)) v = false;
                        else return null;
                    }
                    return { commands: [{ type: "node.update", id: i.id, patch: { propValues: { ...(i.propValues ?? {}), [prop.id]: v } } }] };
                },
                locked: (d, a) => !instanceAt(d, a),
            });
        }
    });
    return cols;
}

// ---- Values: what a cell shows, and series for the fill handle ----

function display(doc: NagmaDocument, col: Column, asset: SceneNode): string {
    const v = col.get(doc, asset);
    if (col.kind === "size") {
        const p = presetFor(v);
        return p ? `${p.label} ${p.w}x${p.h}` : `Custom ${Math.round(asset.w)}x${Math.round(asset.h)}`;
    }
    if (col.kind === "select") return col.options?.(doc, asset).find((o) => o.value === v)?.label ?? v;
    return v;
}

// The values a fill continues with: numbers (or text ending in one) step on; anything else repeats.
export function fillSeries(source: string[], count: number): string[] {
    // A number at the end of the text (before any non-digits): a minus sign belongs to it only at the
    // start or after a space ("SKU-1" counts as SKU-2, SKU-3), and decimals count in steps of their
    // last place, carrying over ("$9.99" → "$10.00", "1.9" → "2.0").
    const parse = (s: string) => /^(.*?)((?:(?<!\S)-)?\d+(?:\.\d+)?)(\D*)$/.exec(s);
    const parts = source.map(parse);
    const places = (p: RegExpExecArray | null) => (p?.[2]?.split(".")[1] ?? "").length;
    const numeric = parts.length > 0 && parts.every((p) => p && p[1] === parts[0]?.[1] && p[3] === parts[0]?.[3] && places(p) === places(parts[0] ?? null));
    if (numeric) {
        const dec = places(parts[0] ?? null);
        const scale = 10 ** dec;
        const nums = parts.map((p) => Math.round(Number(p?.[2]) * scale));
        const step = nums.length > 1 ? (nums[nums.length - 1] as number) - (nums[nums.length - 2] as number) : 1;
        const last = nums[nums.length - 1] as number;
        // Zero padding only when the source has it ("v01" → "v02"; "10", "9" → "8", not "08").
        const digits = (parts[0]?.[2] ?? "").replace("-", "").split(".")[0] ?? "";
        const width = digits.length > 1 && digits.startsWith("0") ? digits.length : 1;
        return Array.from({ length: count }, (_, i) => {
            const n = last + step * (i + 1);
            const abs = Math.abs(n);
            const whole = String(Math.floor(abs / scale)).padStart(width, "0");
            const frac = dec ? `.${String(abs % scale).padStart(dec, "0")}` : "";
            return `${parts[0]?.[1] ?? ""}${n < 0 ? "-" : ""}${whole}${frac}${parts[0]?.[3] ?? ""}`;
        });
    }
    return Array.from({ length: count }, (_, i) => source[i % source.length] ?? "");
}

// Tab-separated rows (a block copied from a spreadsheet), quotes and line breaks in cells kept.
export function parseTsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    const clean = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (quoted) {
            if (ch === '"' && clean[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"' && cell === "") quoted = true;
        else if (ch === "\t") {
            row.push(cell);
            cell = "";
        } else if (ch === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else cell += ch;
    }
    row.push(cell);
    rows.push(row);
    return rows;
}

const tsvCell = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

type Write = { asset: SceneNode; col: Column; value: string };

// Writes values into cells as one undo step; assets made for pasted rows come first.
function writeCells(writes: Write[], create: Command[] = [], created: string[] = []) {
    // Everything below (the edit, picking the new assets, variant switches) folds into one undo step.
    const mark = editor.get().past.at(-1);
    const before = editor.get().doc;
    let work = create.length ? applyCommand(before, { type: "batch", commands: create }) : before;
    const commands: Command[] = [...create];
    const after: (() => void)[] = [];
    for (const w of writes) {
        const asset = work.nodes[w.asset.id];
        if (!asset || w.col.locked(work, asset)) continue;
        const r = w.col.set(work, asset, w.value);
        if (!r) continue;
        if (r.commands.length) {
            commands.push(...r.commands);
            work = applyCommand(work, { type: "batch", commands: r.commands });
        }
        if (r.after) after.push(r.after);
    }
    if (commands.length) {
        if (create.length || writes.some((w) => w.col.kind === "size")) executeArranged(commands, created.length ? created : undefined);
        else editor.execute({ type: "batch", commands });
    }
    for (const run of after) run();
    const past = editor.get().past;
    const start = mark ? past.lastIndexOf(mark) + 1 : 0;
    // (When the history was trimmed past the mark, the steps can't be told apart and stay as they are.)
    if (!mark || start > 0) for (let n = past.length - start; n > 1; n--) editor.mergeLast();
}

// ---- AI fill: the empty cells of a text column, from the rest of each row ----

async function aiFill(doc: NagmaDocument, group: Group, cols: Column[], col: Column): Promise<number> {
    const rows = group.assets.map((a) => Object.fromEntries(cols.filter((c) => c.kind === "text").map((c) => [c.label, c.get(doc, a)])));
    const empty = group.assets.map((a, i) => (col.get(doc, a).trim() ? -1 : i)).filter((i) => i >= 0);
    if (!empty.length) return 0;
    let values: string[] | null = null;
    try {
        const res = await fetch(`${httpBase()}/ai/chat`, {
            method: "POST",
            headers: { "content-type": "application/json", ...aiRequestHeaders() },
            body: JSON.stringify({
                text: `These are rows of marketing assets. Write the "${col.label}" value for rows ${empty.map((i) => i + 1).join(", ")}, matching the tone and length of the filled rows. Reply only with JSON: {"values":["…", …]} in that order.\n\n${JSON.stringify(rows)}`,
                selection: [],
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok && keyNeeded(await aiError(res))) notifyKeyNeeded("Filled as a series. Add your AI key in Account settings to fill cells with AI.");
        if (res.ok) {
            const reply = ((await res.json()) as { reply?: string }).reply ?? "";
            const parsed = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)) as { values?: unknown[] };
            if (Array.isArray(parsed.values)) values = parsed.values.map((v) => String(v ?? ""));
        }
    } catch {
        values = null;
    }
    // Without a model the filled cells continue as a series.
    const filled = group.assets.map((a) => col.get(doc, a)).filter((v) => v.trim());
    const fallback = filled.length ? fillSeries(filled.slice(-2), empty.length) : [];
    const out = empty.map((i, k) => ({ asset: group.assets[i] as SceneNode, col, value: values?.[k] ?? fallback[k] ?? "" })).filter((w) => w.value);
    writeCells(out);
    return out.length;
}

// ---- The table ----

interface Cursor {
    row: number;
    col: number;
}

function CellEditor({ col, asset, initial, onDone }: { col: Column; asset: SceneNode; initial: string | null; onDone: (value: string | null, move: "down" | "right" | "none") => void }) {
    const doc = useEditor((s) => s.doc);
    const [value, setValue] = useState(initial ?? col.get(doc, asset));
    const input = useRef<HTMLInputElement>(null);
    const select = useRef<HTMLSelectElement>(null);
    const done = useRef(false);
    const finish = (v: string | null, move: "down" | "right" | "none") => {
        if (done.current) return;
        done.current = true;
        onDone(v, move);
    };
    useEffect(() => {
        input.current?.focus();
        select.current?.focus();
        if (initial === null) input.current?.select();
    }, [initial]);
    const keys = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            finish(value, "down");
        } else if (e.key === "Tab") {
            e.preventDefault();
            finish(value, "right");
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null, "none");
        }
    };
    const cls = "h-full w-full min-w-0 bg-panel px-2 text-[11px] text-ink outline-none ring-1 ring-brand-500 ring-inset";
    if (col.kind === "size" || col.kind === "select") {
        const options = col.kind === "size" ? SIZE_GROUPS.flatMap((g) => SIZE_PRESETS.filter((p) => p.group === g).map((p) => ({ value: p.id, label: `${p.label} ${p.w}x${p.h}` }))) : (col.options?.(doc, asset) ?? []);
        return (
            <select ref={select} aria-label={`${col.label} for ${asset.name}`} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={keys} onBlur={() => finish(value, "none")} className={cls}>
                {col.kind === "size" && value === "custom" && <option value="custom">{`Custom ${Math.round(asset.w)}x${Math.round(asset.h)}`}</option>}
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        );
    }
    return <input ref={input} aria-label={`${col.label} for ${asset.name}`} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={keys} onBlur={() => finish(value, "none")} className={cls} />;
}

function CellView({ col, asset }: { col: Column; asset: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const v = col.get(doc, asset);
    if (col.kind === "image") {
        const node = fieldNamed(doc, asset.id, col.label);
        return (
            <span className="flex min-w-0 items-center gap-1.5">
                {node ? <AssetThumb id={node.id} width={14} height={14} className="shrink-0 rounded-[2px] bg-canvas" /> : null}
                <span className="truncate">{v ? node?.name || "image" : "Add image"}</span>
            </span>
        );
    }
    if (col.kind === "color") {
        return (
            <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-3.5 shrink-0 rounded-[3px] border border-panel-border" style={{ background: v || "transparent" }} />
                <span className="truncate font-mono text-[10.5px]">{v.toUpperCase()}</span>
            </span>
        );
    }
    return <span className="truncate">{display(doc, col, asset)}</span>;
}

const CELL = "relative flex h-[41px] shrink-0 items-center border-r border-b border-panel-border px-2 text-[11px] text-ink outline-none";
const HEAD = "flex h-[41px] shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-b border-panel-border px-2 text-[11px] font-medium text-ink";

function ColumnSettings({ cols, hidden, setHidden }: { cols: Column[]; hidden: Set<string>; setHidden: (next: Set<string>) => void }) {
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Columns" className="flex size-6 items-center justify-center rounded text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Sliders02 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={6} className="w-56 rounded-lg border border-panel-border bg-panel p-2 text-[11px] text-ink shadow-xl outline-none">
                <AriaDialog aria-label="Columns" className="max-h-80 overflow-y-auto outline-none">
                    <div className="mb-1 px-1 font-semibold">Columns</div>
                    {cols.length <= 1 && <p className="px-1 text-ink-muted">This template has no editable fields yet.</p>}
                    {cols
                        .filter((c) => c.key !== "size")
                        .map((c) => (
                            <label key={c.key} className="flex h-7 items-center gap-2 rounded px-1 hover:bg-panel-hover">
                                <input
                                    type="checkbox"
                                    checked={!hidden.has(c.key)}
                                    onChange={(e) => {
                                        const next = new Set(hidden);
                                        if (e.target.checked) next.delete(c.key);
                                        else next.add(c.key);
                                        setHidden(next);
                                    }}
                                    className="accent-brand-500"
                                />
                                {c.icon}
                                <span className="truncate">{c.label}</span>
                            </label>
                        ))}
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

function ColumnHeader({ col, group, cols, onSelect }: { col: Column; group: Group; cols: Column[]; onSelect: () => void }) {
    const [busy, setBusy] = useState(false);
    return (
        <div role="columnheader" className={`${HEAD} group/head`} style={{ width: col.width }} title={col.label}>
            <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none">
                {col.icon}
                <span className="truncate">{col.label}</span>
            </button>
            {col.kind === "text" && (
                <AriaMenuTrigger>
                    <AriaButton aria-label={`${col.label} column`} className="flex size-4 shrink-0 items-center justify-center rounded text-ink-muted opacity-0 outline-none group-hover/head:opacity-100 hover:text-ink focus-visible:opacity-100">
                        {busy ? <Stars02 className="size-3 animate-pulse" /> : <ChevronDown className="size-3" />}
                    </AriaButton>
                    <AriaPopover placement="bottom end" offset={4} className="w-52 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                        <AriaMenu
                            aria-label={`${col.label} column`}
                            className="outline-none"
                            onAction={(key) => {
                                if (key === "select") onSelect();
                                if (key === "ai") {
                                    setBusy(true);
                                    void aiFill(editor.get().doc, group, cols, col)
                                        .then((n) => editor.notify(n ? `Filled ${n} empty cell${n === 1 ? "" : "s"} in ${col.label}.` : `${col.label} has no empty cells.`))
                                        .finally(() => setBusy(false));
                                }
                            }}
                        >
                            <MenuRow id="select" label="Select column" />
                            <MenuRow id="ai" label="Fill empty cells with AI" />
                        </AriaMenu>
                    </AriaPopover>
                </AriaMenuTrigger>
            )}
        </div>
    );
}

function GroupTable({ group }: { group: Group }) {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const current = useCampaign((s) => s.current);
    const [open, setOpen] = useState(true);
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [cursor, setCursor] = useState<Cursor | null>(null);
    const [anchor, setAnchor] = useState<Cursor | null>(null);
    const [editing, setEditing] = useState<{ initial: string | null } | null>(null);
    const [fillTo, setFillTo] = useState<number | null>(null);
    const [dragRow, setDragRow] = useState<{ from: string; over: string | null } | null>(null);
    const grid = useRef<HTMLDivElement>(null);
    const allCols = columnsOf(doc, group);
    const cols = allCols.filter((c) => !hidden.has(c.key));
    const assets = group.assets;
    const range = cursor
        ? {
              r0: Math.min(cursor.row, anchor?.row ?? cursor.row),
              r1: Math.max(cursor.row, anchor?.row ?? cursor.row),
              c0: Math.min(cursor.col, anchor?.col ?? cursor.col),
              c1: Math.max(cursor.col, anchor?.col ?? cursor.col),
          }
        : null;
    const inRange = (r: number, c: number) => Boolean(range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1);
    const checked = new Set(selection);
    const all = assets.every((a) => checked.has(a.id));
    // The row in focus shows in the preview (and is the selection, so the toolbar and menus act on it).
    const show = (row: number) => {
        const a = assets[row];
        if (!a) return;
        if (campaign.get().current !== a.id) campaign.set({ current: a.id });
        const s = editor.get();
        if (s.selection.length !== 1 || s.selection[0] !== a.id) editor.set({ selection: [a.id], editingTextId: null });
    };
    const moveTo = (row: number, col: number, extend = false) => {
        const r = Math.max(0, Math.min(assets.length - 1, row));
        const c = Math.max(0, Math.min(cols.length - 1, col));
        if (extend && !anchor && cursor) setAnchor(cursor);
        if (!extend) setAnchor(null);
        setCursor({ row: r, col: c });
        show(r);
    };
    const focusGrid = () => grid.current?.focus({ preventScroll: true });
    const commitEdit = (value: string | null, move: "down" | "right" | "none") => {
        const at = cursor;
        setEditing(null);
        if (at && value !== null) {
            const asset = assets[at.row];
            const col = cols[at.col];
            if (asset && col && value !== col.get(editor.get().doc, asset)) writeCells([{ asset, col, value }]);
        }
        if (at && move === "down") moveTo(at.row + 1, at.col);
        if (at && move === "right") moveTo(at.row, at.col + 1);
        requestAnimationFrame(focusGrid);
    };
    const startEdit = (initial: string | null) => {
        if (!cursor || readOnly) return;
        const asset = assets[cursor.row];
        const col = cols[cursor.col];
        if (!asset || !col || col.locked(doc, asset)) return;
        if (col.kind === "image") {
            const node = fieldNamed(doc, asset.id, col.label);
            if (!node) return;
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = () => {
                const file = input.files?.[0];
                if (file) void replaceImage(node, file);
            };
            input.click();
            return;
        }
        setEditing({ initial });
    };
    const pasteBlock = (rows: string[][]) => {
        if (!cursor || readOnly || !rows.length) return;
        const docNow = editor.get().doc;
        // More rows than there are: new assets from the template, after the last one.
        const extra = Math.max(0, cursor.row + rows.length - assets.length);
        const create: Command[] = [];
        const made: SceneNode[] = [];
        const last = assets[assets.length - 1] ?? group.root;
        const rowId = assetData(last)?.rowId ?? "";
        for (let i = 0; i < extra; i++) {
            const copies = copyAsset(docNow, group.root.id, { x: last.x + (last.w + ASSET_GAP) * (i + 1), y: last.y }, { rowId }, `${group.root.name} ${assets.length + i + 1}`);
            if (!copies[0]) continue;
            made.push(copies[0]);
            create.push(...createCommands(copies));
        }
        const targets = [...assets, ...made];
        const writes: Write[] = [];
        rows.forEach((cells, i) => {
            const asset = targets[cursor.row + i];
            if (!asset) return;
            cells.forEach((value, j) => {
                const col = cols[cursor.col + j];
                if (col) writes.push({ asset, col, value });
            });
        });
        writeCells(writes, create, made.map((m) => m.id));
        setAnchor({ row: Math.min(targets.length - 1, cursor.row + rows.length - 1), col: Math.min(cols.length - 1, cursor.col + (rows[0]?.length ?? 1) - 1) });
        if (extra) editor.notify(`Added ${made.length} asset${made.length === 1 ? "" : "s"} for the pasted rows.`);
    };
    const fill = (to: number) => {
        if (!range || readOnly) return;
        const down = to > range.r1;
        const count = down ? to - range.r1 : range.r0 - to;
        if (count <= 0) return;
        const docNow = editor.get().doc;
        const writes: Write[] = [];
        for (let c = range.c0; c <= range.c1; c++) {
            const col = cols[c];
            if (!col) continue;
            const source = assets.slice(range.r0, range.r1 + 1).map((a) => col.get(docNow, a));
            const ordered = down ? source : [...source].reverse();
            const series = col.kind === "text" ? fillSeries(ordered, count) : Array.from({ length: count }, (_, i) => ordered[i % ordered.length] ?? "");
            series.forEach((value, i) => {
                const asset = assets[down ? range.r1 + 1 + i : range.r0 - 1 - i];
                if (asset) writes.push({ asset, col, value });
            });
        }
        writeCells(writes);
        setCursor({ row: down ? range.r0 : to, col: range.c0 });
        setAnchor({ row: down ? to : range.r1, col: range.c1 });
    };
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (editing || !cursor) return;
        const mod = e.metaKey || e.ctrlKey;
        // The table's keys stay here, out of the canvas's shortcuts (undo and save still go through).
        if (!(mod && ["z", "y", "s"].includes(e.key.toLowerCase()))) e.stopPropagation();
        const step = (dr: number, dc: number, extend = e.shiftKey) => {
            e.preventDefault();
            moveTo(cursor.row + dr, cursor.col + dc, extend);
        };
        if (e.key === "ArrowDown") return step(1, 0);
        if (e.key === "ArrowUp") return step(-1, 0);
        if (e.key === "ArrowRight") return step(0, 1);
        if (e.key === "ArrowLeft") return step(0, -1);
        if (e.key === "Tab") return step(0, e.shiftKey ? -1 : 1, false);
        if (e.key === "Enter" || e.key === "F2") {
            e.preventDefault();
            return startEdit(null);
        }
        if (e.key === "Escape") return setAnchor(null);
        if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            if (!range || readOnly) return;
            writeCells(assets.slice(range.r0, range.r1 + 1).flatMap((asset) => cols.slice(range.c0, range.c1 + 1).filter((c) => c.kind === "text").map((col) => ({ asset, col, value: "" }))));
            return;
        }
        if (mod && e.key.toLowerCase() === "d") {
            e.preventDefault();
            if (range && !readOnly) duplicateAssets(assets.slice(range.r0, range.r1 + 1).map((a) => a.id));
            return;
        }
        if (mod && e.key.toLowerCase() === "a") {
            e.preventDefault();
            setCursor({ row: 0, col: 0 });
            setAnchor({ row: assets.length - 1, col: cols.length - 1 });
            return;
        }
        // Typing starts editing a text or colour cell with what was typed.
        if (!mod && !e.altKey && e.key.length === 1) {
            const col = cols[cursor.col];
            if (col && (col.kind === "text" || col.kind === "color")) {
                e.preventDefault();
                startEdit(e.key);
            }
        }
    };
    const onCopy = (e: React.ClipboardEvent) => {
        if (editing || !range) return;
        e.preventDefault();
        e.stopPropagation();
        const docNow = editor.get().doc;
        const rows = assets.slice(range.r0, range.r1 + 1).map((a) => cols.slice(range.c0, range.c1 + 1).map((c) => tsvCell(c.get(docNow, a))).join("\t"));
        e.clipboardData.setData("text/plain", rows.join("\n"));
    };
    const onPaste = (e: React.ClipboardEvent) => {
        if (editing || !cursor) return;
        const text = e.clipboardData.getData("text/plain");
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        const rows = parseTsv(text);
        // One value pasted over a range fills all of it.
        if (rows.length === 1 && rows[0]?.length === 1 && range && (range.r1 > range.r0 || range.c1 > range.c0)) {
            const value = rows[0][0] ?? "";
            writeCells(assets.slice(range.r0, range.r1 + 1).flatMap((asset) => cols.slice(range.c0, range.c1 + 1).map((col) => ({ asset, col, value }))));
            return;
        }
        pasteBlock(rows);
    };
    // The fill handle: dragged over rows, it fills them from the selected cells.
    const startFill = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        let to: number | null = null;
        const move = (ev: PointerEvent) => {
            const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-bulk-row]");
            const row = el && el.closest("[role=grid]") === grid.current ? Number(el.dataset.bulkRow) : NaN;
            if (!Number.isNaN(row)) {
                to = row;
                setFillTo(row);
            }
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setFillTo(null);
            if (to !== null) fill(to);
            focusGrid();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const fillRange = fillTo !== null && range ? { r0: Math.min(range.r0, fillTo), r1: Math.max(range.r1, fillTo) } : null;
    const n = assets.length;
    return (
        <section aria-label={`${group.root.name}, ${n} asset${n === 1 ? "" : "s"}`}>
            <div className="flex h-10 items-center gap-2 border-b border-panel-border bg-panel px-1.5 text-[11px] text-ink-muted">
                <button type="button" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => setOpen(!open)} className="flex size-4 items-center justify-center rounded hover:text-ink">
                    {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                <Hash02 className="size-4 text-ink" />
                <span className="ml-2">
                    {n} asset{n === 1 ? "" : "s"}
                </span>
                <span className="truncate text-ink-subtle">{assetData(group.root)?.template ? `from ${group.root.name}` : ""}</span>
            </div>
            {open && (
                <div ref={grid} role="grid" data-bulk-grid="" aria-label={group.root.name} aria-rowcount={n + 1} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste} className="w-max min-w-full outline-none">
                    <div role="row" className="flex bg-panel">
                        <div role="columnheader" className={HEAD} style={{ width: 87 }}>
                            <input type="checkbox" aria-label="Select every asset" checked={all} onChange={(e) => editor.set({ selection: e.target.checked ? assets.map((a) => a.id) : [] })} className="ml-4 size-4 accent-brand-500" />
                        </div>
                        {cols.map((c, ci) => (
                            <ColumnHeader
                                key={c.key}
                                col={c}
                                group={group}
                                cols={allCols}
                                onSelect={() => {
                                    setCursor({ row: 0, col: ci });
                                    setAnchor({ row: n - 1, col: ci });
                                    focusGrid();
                                }}
                            />
                        ))}
                        <div aria-hidden="true" className="min-w-0 flex-1 border-b border-panel-border" />
                        <div role="columnheader" className={`${HEAD} justify-center border-r-0 border-l px-1`} style={{ width: 41 }}>
                            <ColumnSettings cols={allCols} hidden={hidden} setHidden={setHidden} />
                        </div>
                    </div>
                    {assets.map((asset, ri) => {
                        const on = asset.id === current;
                        return (
                            <div
                                key={asset.id}
                                role="row"
                                aria-selected={on}
                                data-bulk-row={ri}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    openAssetMenu(asset.id, e.clientX, e.clientY);
                                }}
                                onDragOver={(e) => {
                                    if (!dragRow) return;
                                    e.preventDefault();
                                    if (dragRow.over !== asset.id) setDragRow({ ...dragRow, over: asset.id });
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const target = assetData(asset);
                                    if (dragRow && dragRow.from !== asset.id && target) placeAsset(dragRow.from, target.rowId, asset.id);
                                    setDragRow(null);
                                }}
                                className={`relative flex ${on ? "bg-row-on" : "bg-field hover:bg-row-hover"}`}
                            >
                                {dragRow?.over === asset.id && dragRow.from !== asset.id && <span aria-hidden="true" className="absolute inset-x-0 -top-px z-10 h-0.5 bg-brand-500" />}
                                <div role="gridcell" className={`${CELL} group/row gap-2 pl-1`} style={{ width: 87 }}>
                                    {!readOnly && (
                                        <span
                                            draggable
                                            aria-label={`Drag ${asset.name} to reorder`}
                                            title="Drag to reorder"
                                            onDragStart={(e) => {
                                                e.dataTransfer.effectAllowed = "move";
                                                e.dataTransfer.setData("text/plain", asset.id);
                                                setDragRow({ from: asset.id, over: null });
                                            }}
                                            onDragEnd={() => setDragRow(null)}
                                            className="flex h-5 w-3 shrink-0 cursor-grab items-center justify-center text-ink-subtle opacity-0 group-hover/row:opacity-100"
                                        >
                                            <DotsGrid className="size-3" />
                                        </span>
                                    )}
                                    <input
                                        type="checkbox"
                                        aria-label={`Select ${asset.name}`}
                                        checked={checked.has(asset.id)}
                                        onChange={(e) => {
                                            const s = editor.get();
                                            const assetsOnly = s.selection.filter((id) => assetData(s.doc.nodes[id]));
                                            editor.set({ selection: e.target.checked ? [...new Set([...assetsOnly, asset.id])] : assetsOnly.filter((x) => x !== asset.id) });
                                        }}
                                        className="size-4 shrink-0 accent-brand-500"
                                    />
                                    <button type="button" aria-label={`Show ${asset.name}`} onClick={() => (campaign.set({ current: asset.id }), editor.set({ selection: [asset.id], editingTextId: null }))} className="relative shrink-0">
                                        <AssetThumb id={asset.id} width={24} height={24} />
                                        <ReviewBadge assetId={asset.id} small className="absolute -top-1 -right-1" />
                                    </button>
                                </div>
                                {cols.map((col, ci) => {
                                    const active = cursor?.row === ri && cursor.col === ci;
                                    const picked = inRange(ri, ci);
                                    const filling = Boolean(fillRange && range && ri >= fillRange.r0 && ri <= fillRange.r1 && ci >= range.c0 && ci <= range.c1);
                                    const locked = readOnly || col.locked(doc, asset);
                                    const handle = Boolean(range && ri === range.r1 && ci === range.c1 && !editing && !readOnly);
                                    return (
                                        <div
                                            key={col.key}
                                            role="gridcell"
                                            aria-selected={picked}
                                            aria-readonly={locked}
                                            data-bulk-cell={`${ri}:${ci}`}
                                            onPointerDown={(e) => {
                                                if (e.button !== 0 || (active && editing)) return;
                                                if (e.shiftKey && cursor) {
                                                    e.preventDefault();
                                                    if (!anchor) setAnchor(cursor);
                                                    setCursor({ row: ri, col: ci });
                                                    show(ri);
                                                    requestAnimationFrame(focusGrid);
                                                    return;
                                                }
                                                setCursor({ row: ri, col: ci });
                                                setAnchor(null);
                                                setEditing(null);
                                                show(ri);
                                                // Dragging across cells selects a range.
                                                const move = (ev: PointerEvent) => {
                                                    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-bulk-cell]");
                                                    if (!el || el.closest("[role=grid]") !== grid.current) return;
                                                    const [r, c] = (el.dataset.bulkCell ?? "").split(":").map(Number);
                                                    if (r === undefined || c === undefined || Number.isNaN(r) || Number.isNaN(c) || (r === ri && c === ci)) return;
                                                    setAnchor({ row: ri, col: ci });
                                                    setCursor({ row: r, col: c });
                                                };
                                                const up = () => {
                                                    window.removeEventListener("pointermove", move);
                                                    window.removeEventListener("pointerup", up);
                                                };
                                                window.addEventListener("pointermove", move);
                                                window.addEventListener("pointerup", up);
                                                requestAnimationFrame(focusGrid);
                                            }}
                                            onDoubleClick={() => startEdit(null)}
                                            className={`${CELL} ${editing && active ? "p-0" : ""} ${(picked || filling) && !(active && !editing) ? "bg-brand-500/10" : ""} ${active && !editing ? "bg-brand-100" : ""} ${locked ? "text-ink-muted" : ""}`}
                                            style={{ width: col.width }}
                                        >
                                            {editing && active ? <CellEditor col={col} asset={asset} initial={editing.initial} onDone={commitEdit} /> : <CellView col={col} asset={asset} />}
                                            {active && !editing && <span aria-hidden="true" className="pointer-events-none absolute -inset-px z-10 border border-brand-500" />}
                                            {active && !editing && !locked && (
                                                <button type="button" aria-label={`Edit ${col.label}`} tabIndex={-1} onClick={() => startEdit(null)} className="absolute top-1/2 right-2 z-10 flex size-4 -translate-y-1/2 items-center justify-center text-ink">
                                                    <DotsGrid className="size-3.5" />
                                                </button>
                                            )}
                                            {/* The fill handle: a pill under the cell's middle and a ring at its corner; either drags to fill. */}
                                            {handle && <span role="presentation" title="Drag to fill" onPointerDown={startFill} className="absolute -bottom-[4px] left-1/2 z-20 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded-full border border-brand-500 bg-white" />}
                                            {handle && <span role="presentation" title="Drag to fill" onPointerDown={startFill} className="absolute -right-[5px] -bottom-[5px] z-20 size-2.5 cursor-crosshair rounded-full border border-brand-500 bg-panel" />}
                                        </div>
                                    );
                                })}
                                <div aria-hidden="true" className="min-w-0 flex-1 border-b border-panel-border" />
                                <div role="gridcell" className={`${CELL} border-r-0 border-l`} style={{ width: 41 }} />
                            </div>
                        );
                    })}
                    {!readOnly && (
                        <button type="button" onClick={() => duplicateAssets([group.root.id])} className="flex h-[41px] w-full items-center gap-3 border-b border-panel-border bg-panel px-[22px] text-left text-[11px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-1 focus-visible:ring-brand-500 focus-visible:ring-inset">
                            <Plus className="size-4" /> Asset
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

export function BulkTable() {
    const doc = useEditor((s) => s.doc);
    const groups = groupsOf(doc);
    return (
        <div aria-label="Bulk edit" className="h-full w-[800px] max-w-[60%] shrink-0 overflow-auto border-r border-panel-border bg-field">
            {groups.length === 0 && <p className="px-4 py-4 text-[11px] text-ink-muted">No assets yet. Add a template, then add rows here or upload a spreadsheet.</p>}
            {groups.map((g) => (
                <GroupTable key={g.root.id} group={g} />
            ))}
        </div>
    );
}

export function BulkHeader() {
    const doc = useEditor((s) => s.doc);
    const readOnly = useEditor((s) => s.readOnly);
    const current = useCampaign((s) => s.current);
    const asset = current ? doc.nodes[current] : undefined;
    const data = assetData(asset);
    const templateId = data?.template ? asset?.id : (data?.sourceId ?? undefined);
    return (
        <div className="flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
            <AriaButton aria-label="Back to the assets" onPress={() => campaign.set({ panel: "assets" })} className="-ml-1.5 flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                <ChevronLeft className="size-4" />
            </AriaButton>
            <h2 className="text-[13px] font-semibold text-ink">Bulk edit</h2>
            {!readOnly && (
                <AriaButton onPress={() => campaign.set({ dialog: { kind: "bulk", templateId } })} className="ml-1.5 flex h-6 items-center gap-1.5 rounded-[5px] border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover">
                    <Upload01 className="size-4" /> Upload spreadsheet
                </AriaButton>
            )}
        </div>
    );
}

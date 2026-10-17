import { readImage } from "../engine/images";
import { imagePaint } from "../engine/paint";
import { editor, useEditor } from "../engine/store";
import type { Command, ImagePaint, SceneNode } from "../engine/types";
import { Select } from "../components/select";
import { ColorSwatch } from "../components/color-picker";
import { CODE_LANGUAGES, chartData, editTable, numberAllSlides, setChartData, setCodeStyle, setNumberFormatOf } from "./widgets";
import { deckOf, deckPage, isEmptyPlaceholder } from "./model";
import { cloneSubtree } from "../engine/nodes";
import type { NumberFormat } from "./types";
import { type TableLook, cellOf, deleteColumns, deleteRows, insertColumn, insertRow, mergeCells, setCellFill, setCellTextColor, setCellTextStyle, setTableBorder, splitCell, styleTable, tableModel, tableOf } from "./tables";

// Right-panel sections for what's selected on a slide: video playback, alt text, code blocks,
// tables and charts.

const field = "h-7 min-w-0 flex-1 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
const small = "h-7 flex-1 rounded-md bg-field px-2 text-ink hover:bg-panel-hover disabled:opacity-40";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="border-b border-panel-border px-4 pb-4 pt-3">
            <h3 className="flex h-6 items-center font-semibold">{title}</h3>
            <div className="mt-2 space-y-2">{children}</div>
        </section>
    );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className={`flex h-6 items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500" />
            <span>{label}</span>
        </label>
    );
}

function VideoSection({ node }: { node: SceneNode }) {
    const paint = node.fills.find((p): p is ImagePaint => p.type === "image" && Boolean(p.video));
    const video = paint?.video;
    if (!paint || !video) return null;
    const set = (patch: Partial<NonNullable<ImagePaint["video"]>>) =>
        editor.execute({ type: "node.update", id: node.id, patch: { fills: node.fills.map((p) => (p === paint ? { ...paint, video: { ...video, ...patch } } : p)) } });
    return (
        <Section title="Video playback">
            <Check label="Autoplay" checked={video.autoplay !== false} onChange={(autoplay) => set({ autoplay })} />
            <Check label="Loop" checked={video.loop} onChange={(loop) => set({ loop })} />
            <Check label="Sound" checked={!video.muted} disabled={!video.hasAudio} onChange={(on) => set({ muted: !on })} />
            <div className="text-ink-muted">Plays while you present.</div>
        </Section>
    );
}

function AltTextSection({ node }: { node: SceneNode }) {
    if (isEmptyPlaceholder(node)) return null;
    const value = node.altText ?? "";
    return (
        <Section title="Alt text">
            <textarea
                aria-label="Alt text"
                placeholder="Describe the picture for people using screen readers"
                defaultValue={value}
                key={`${node.id}:${value}`}
                rows={2}
                onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next !== value) editor.execute({ type: "node.update", id: node.id, patch: { altText: next || undefined } });
                }}
                className="w-full resize-none rounded-md border border-transparent bg-field p-1.5 text-ink outline-none placeholder:text-ink-muted focus:border-brand-500"
            />
        </Section>
    );
}

function CodeSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    // The block's frame or its text.
    const text = node.deck?.kind === "code" ? node : node.children.map((c) => doc.nodes[c]).find((c) => c?.deck?.kind === "code");
    const data = text?.deck?.kind === "code" ? text.deck : null;
    if (!text || !data) return null;
    return (
        <Section title="Code block">
            <label className="flex items-center gap-2">
                <span className="w-16 text-ink-muted">Language</span>
                <Select aria-label="Code language" value={data.lang} onChange={(e) => setCodeStyle(text.id, { lang: e.target.value })} className={field}>
                    {CODE_LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                    ))}
                </Select>
            </label>
            <label className="flex items-center gap-2">
                <span className="w-16 text-ink-muted">Theme</span>
                <Select aria-label="Code theme" value={data.theme ?? "dark"} onChange={(e) => setCodeStyle(text.id, { theme: e.target.value as "dark" | "light" })} className={field}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                </Select>
            </label>
        </Section>
    );
}

const LOOKS: { id: TableLook; label: string }[] = [
    { id: "header", label: "Header" },
    { id: "banded", label: "Banded" },
    { id: "lined", label: "Lines" },
    { id: "plain", label: "Plain" },
];

// A table, or cells in it: the table's look and borders, then the selected cells' fill and text,
// merging, and inserting or deleting their rows and columns.
function TableSection({ node, cells }: { node: SceneNode; cells: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    if (node.deck?.kind !== "table") return null;
    const model = tableModel(doc, node);
    const rows = model.rows.length;
    const cols = model.cols.length;
    const picked = model.cells.filter((c) => cells.some((n) => n.id === c.id));
    const ids = picked.map((c) => c.id);
    const firstCell = cells[0];
    const fill = firstCell?.fills[0]?.type === "solid" ? firstCell.fills[0].color : null;
    const text = firstCell ? doc.nodes[firstCell.children.find((t) => doc.nodes[t]?.type === "text") ?? ""] : undefined;
    const textColor = text?.fills[0]?.type === "solid" ? text.fills[0].color : "#000000";
    const stroke = node.children.map((c) => doc.nodes[c]).find((c) => c?.strokes.length)?.strokes[0];
    const strokeColor = stroke?.type === "solid" ? stroke.color : null;
    const strokeWidth = node.children.map((c) => doc.nodes[c]).find((c) => c?.strokes.length)?.strokeWidth ?? 2;
    const rowsOf = [...new Set(picked.flatMap((c) => Array.from({ length: c.rs }, (_, i) => c.r + i)))];
    const colsOf = [...new Set(picked.flatMap((c) => Array.from({ length: c.cs }, (_, i) => c.c + i)))];
    const merged = picked.length === 1 && (picked[0]?.rs ?? 1) * (picked[0]?.cs ?? 1) > 1;
    const look = node.deck.look;
    return (
        <>
            <Section title="Table">
                <div className="text-ink-muted">{rows} rows, {cols} columns. Double-click a cell to type in it; the bars beside the table select, move and add rows and columns.</div>
                <div role="radiogroup" aria-label="Table look" className="flex h-7 rounded-md bg-field p-0.5">
                    {LOOKS.map((l) => (
                        <button key={l.id} type="button" role="radio" aria-checked={look === l.id} onClick={() => styleTable(node.id, l.id)} className={`flex-1 rounded text-[11px] ${look === l.id ? "bg-white/[0.08] text-ink" : "text-ink-muted hover:text-ink"}`}>
                            {l.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-14 text-ink-muted">Borders</span>
                    <ColorSwatch label="Border colour" color={strokeColor ?? "#000000"} size={5} onChange={(c) => setTableBorder(node.id, c)} />
                    <input aria-label="Border width" type="number" min={0} max={20} defaultValue={strokeColor ? strokeWidth : 0} key={`${strokeColor}${strokeWidth}`} onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setTableBorder(node.id, v > 0 ? (strokeColor ?? "#D1D1D1") : null, v > 0 ? v : undefined);
                    }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={`${field} w-14 flex-none`} />
                </div>
                <div className="flex gap-1.5">
                    <button type="button" className={small} onClick={() => editTable(node.id, "add-row")}>Add row</button>
                    <button type="button" className={small} onClick={() => editTable(node.id, "add-column")}>Add column</button>
                </div>
            </Section>
            {picked.length > 0 && (
                <Section title={picked.length === 1 ? "Cell" : `${picked.length} cells`}>
                    <div className="flex items-center gap-2">
                        <span className="w-14 text-ink-muted">Fill</span>
                        <ColorSwatch label="Cell fill" color={fill ?? "#FFFFFF"} size={5} onChange={(c) => setCellFill(ids, c)} />
                        <button type="button" onClick={() => setCellFill(ids, null)} className="rounded px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink">None</button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-14 text-ink-muted">Text</span>
                        <ColorSwatch label="Cell text colour" color={textColor} size={5} onChange={(c) => setCellTextColor(ids, c)} />
                        <button type="button" aria-pressed={(text?.fontWeight ?? 400) >= 600} onClick={() => setCellTextStyle(ids, { fontWeight: (text?.fontWeight ?? 400) >= 600 ? 400 : 700 })} className="h-6 rounded px-2 font-bold hover:bg-panel-hover">B</button>
                        {(["left", "center", "right"] as const).map((a) => (
                            <button key={a} type="button" aria-pressed={text?.textAlign === a} aria-label={`Align ${a}`} onClick={() => setCellTextStyle(ids, { textAlign: a })} className={`h-6 rounded px-1.5 ${text?.textAlign === a ? "bg-panel-hover text-ink" : "text-ink-muted hover:bg-panel-hover"}`}>
                                {a === "left" ? "L" : a === "center" ? "C" : "R"}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" className={small} disabled={picked.length < 2} onClick={() => mergeCells(node.id, ids)}>Merge cells</button>
                        <button type="button" className={small} disabled={!merged} onClick={() => splitCell(node.id, ids[0] as string)}>Split cell</button>
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" className={small} onClick={() => insertRow(node.id, Math.min(...rowsOf))}>Row above</button>
                        <button type="button" className={small} onClick={() => insertRow(node.id, Math.max(...rowsOf) + 1)}>Row below</button>
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" className={small} onClick={() => insertColumn(node.id, Math.min(...colsOf))}>Column left</button>
                        <button type="button" className={small} onClick={() => insertColumn(node.id, Math.max(...colsOf) + 1)}>Column right</button>
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" className={small} disabled={rowsOf.length >= rows} onClick={() => deleteRows(node.id, rowsOf)}>Delete {rowsOf.length > 1 ? "rows" : "row"}</button>
                        <button type="button" className={small} disabled={colsOf.length >= cols} onClick={() => deleteColumns(node.id, colsOf)}>Delete {colsOf.length > 1 ? "columns" : "column"}</button>
                    </div>
                </Section>
            )}
        </>
    );
}

function ChartSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    if (node.deck?.kind !== "chart") return null;
    const { labels, values } = chartData(doc, node);
    const text = labels.map((l, i) => `${l}, ${values[i] ?? 0}`).join("\n");
    return (
        <Section title="Chart data">
            <textarea
                aria-label="Chart data"
                defaultValue={text}
                key={text}
                rows={Math.min(10, Math.max(3, labels.length + 1))}
                onBlur={(e) => {
                    const rows = e.target.value
                        .split("\n")
                        .map((line) => line.split(/[,\t]/).map((p) => p.trim()))
                        .filter((p) => p[0]);
                    const nextLabels = rows.map((p) => p[0] ?? "");
                    const nextValues = rows.map((p) => {
                        const v = Number(p[1]);
                        return Number.isFinite(v) ? v : 0;
                    });
                    if (rows.length && nextLabels.map((l, i) => `${l}, ${nextValues[i]}`).join("\n") !== text) setChartData(node.id, nextLabels, nextValues);
                }}
                className="w-full resize-none rounded-md border border-transparent bg-field p-1.5 font-mono text-ink outline-none focus:border-brand-500"
            />
            <div className="text-ink-muted">One bar per line: a label, a comma, then its value. Paste from a spreadsheet works too.</div>
        </Section>
    );
}

// The table or chart a selected layer belongs to (itself, or the nearest one around it).
function owner(doc: ReturnType<typeof editor.get>["doc"], node: SceneNode, kind: "chart"): SceneNode | null {
    let at: SceneNode | undefined = node;
    while (at) {
        if (at.deck?.kind === kind) return at;
        at = at.parentId ? doc.nodes[at.parentId] : undefined;
    }
    return null;
}

// An instance whose main component was deleted: Restore component makes a main component again
// from it, beside the slides, and the instance follows it.
function RestoreComponentSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    if (node.type !== "instance" || !node.componentId || doc.nodes[node.componentId] || node.libraryKey) return null;
    return (
        <Section title="Component">
            <div className="text-ink-muted">The main component of this instance was deleted.</div>
            <button type="button" className={`${small} w-full`} onClick={() => restoreComponent(node.id)}>Restore component</button>
        </Section>
    );
}

function restoreComponent(instanceId: string) {
    const s = editor.get();
    const instance = s.doc.nodes[instanceId];
    const page = deckPage(s.doc);
    if (!instance || !page || s.readOnly) return;
    const right = Math.max(0, ...page.children.map((id) => s.doc.nodes[id]).filter((n): n is SceneNode => Boolean(n)).map((n) => n.x + n.w));
    const dx = right + 400 - instance.x;
    const dy = -instance.y;
    const copies = cloneSubtree(s.doc, instanceId, 0, page.id);
    const main = copies[0];
    if (!main) return;
    const commands: Command[] = copies.map((n, i) => ({
        type: "node.create" as const,
        node: { ...n, children: [], x: n.x + dx, y: n.y + dy, sourceId: undefined, overrides: undefined, ...(i === 0 ? { type: "component" as const, componentId: undefined, name: instance.name, deck: undefined } : {}) },
    }));
    commands.push({ type: "node.update", id: instanceId, patch: { componentId: main.id } });
    editor.execute({ type: "batch", commands });
    editor.notify("Component restored. Its main component sits to the right of the slides.");
}

// A slide number placed by hand: whether it shows the total and how, and copying it to every slide.
function SlideNumberSection({ node }: { node: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    if (node.deck?.kind !== "text" || node.deck.role !== "slide-number") return null;
    const format = node.deck.format ?? deckOf(doc).numberFormat ?? "plain";
    return (
        <Section title="Slide number">
            <Check label="Include total" checked={format !== "plain"} onChange={(on) => setNumberFormatOf(node.id, on ? "of" : "plain")} />
            {format !== "plain" && (
                <Select aria-label="Slide number format" value={format} onChange={(e) => setNumberFormatOf(node.id, e.target.value as NumberFormat)} className={`${field} w-full`}>
                    <option value="of">3 of 12</option>
                    <option value="slash">3 / 12</option>
                </Select>
            )}
            <button type="button" className={`${small} w-full`} onClick={() => numberAllSlides(node.id)}>Add to all slides</button>
        </Section>
    );
}

// A layout's picture placeholder: Choose media fills it with a picture.
function PlaceholderSection({ node }: { node: SceneNode }) {
    if (node.deck?.kind !== "shape" || node.deck.role !== "placeholder") return null;
    const filled = !isEmptyPlaceholder(node);
    return (
        <Section title="Media placeholder">
            <button type="button" className={small} onClick={() => chooseMedia(node.id)}>{filled ? "Replace media" : "Choose media"}</button>
            <div className="text-ink-muted">The picture fills the placeholder; drag it to crop in the Fill section.</div>
        </Section>
    );
}

function chooseMedia(id: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const image = await readImage(file);
        if (!image) {
            editor.notify(`Couldn't read ${file.name}.`);
            return;
        }
        editor.execute({ type: "batch", commands: [{ type: "image.add", id: image.id, data: image.data }, { type: "node.update", id, patch: { fills: [imagePaint(image.id)], name: file.name.replace(/\.[^.]+$/, "") || "Picture" } }] });
    };
    input.click();
}

export function ObjectSections({ nodes }: { nodes: SceneNode[] }) {
    const doc = useEditor((s) => s.doc);
    // Cells (or their text) of one table, or the table itself.
    const tables = new Set(nodes.map((n) => tableOf(doc, n.id)?.id ?? ""));
    const table = tables.size === 1 ? tableOf(doc, nodes[0]?.id) : null;
    const cells = table ? nodes.map((n) => cellOf(doc, n.id)).filter((c): c is SceneNode => Boolean(c)) : [];
    const node = nodes.length === 1 ? nodes[0] : undefined;
    if (!node) return table ? <TableSection node={table} cells={cells} /> : null;
    const chart = owner(doc, node, "chart");
    return (
        <>
            <PlaceholderSection node={node} />
            <RestoreComponentSection node={node} />
            <SlideNumberSection node={node} />
            <CodeSection node={node} />
            {table && <TableSection node={table} cells={cells} />}
            {chart && <ChartSection node={chart} />}
            <VideoSection node={node} />
            <AltTextSection node={node} />
        </>
    );
}

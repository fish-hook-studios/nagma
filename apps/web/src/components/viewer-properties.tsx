import { createElement, useState } from "react";
import { Check, Clipboard, Minus, Plus } from "@untitledui/icons";
import { hexToRgb, rgbToHsl, rgbToHsv } from "../engine/color";
import { EFFECT_LABELS, effectsOf } from "../engine/effects";
import { goToMainComponent } from "../engine/actions";
import { editor, useEditor } from "../engine/store";
import type { Paint, SceneNode } from "../engine/types";
import { Select } from "./select";
import { layerIcon } from "./layer-kind";
import { type ExportFormat, exportLayers } from "../engine/export";
import { refuseExport } from "../engine/share-settings";

// What people with view access see in place of the Design tab: the selection's properties as
// plain values (click one to copy it), colours in the notation they choose, and strokes under
// "Borders", the way the reference's read-only Properties panel reads.

type Notation = "hex" | "rgb" | "css" | "hsl" | "hsb";
let lastNotation: Notation = "hex";

const r = (n: number) => String(Math.round(n * 100) / 100);
const pct = (n: number) => `${Math.round(n * 100)}%`;

function colorText(hex: string, opacity: number, notation: Notation): string {
    const rgb = hexToRgb(hex);
    const [R, G, B] = [rgb.r, rgb.g, rgb.b].map((v) => Math.round(v));
    if (notation === "rgb") return `${R}, ${G}, ${B}${opacity < 1 ? `, ${pct(opacity)}` : ""}`;
    if (notation === "css") return opacity < 1 ? `rgba(${R}, ${G}, ${B}, ${r(opacity)})` : hex.toLowerCase();
    if (notation === "hsl") {
        const { h, s, l } = rgbToHsl(rgb);
        return `${Math.round(h)}°, ${pct(s)}, ${pct(l)}`;
    }
    if (notation === "hsb") {
        const { h, s, v } = rgbToHsv(rgb);
        return `${Math.round(h)}°, ${pct(s)}, ${pct(v)}`;
    }
    return `#${hex.replace("#", "").toUpperCase()}${opacity < 1 ? ` ${pct(opacity)}` : ""}`;
}

function paintText(p: Paint, notation: Notation): string {
    if (p.type === "solid") return colorText(p.color, p.opacity, notation);
    if (p.type === "image") return p.video ? "Video" : "Image";
    if (p.type === "pattern") return "Pattern";
    if (p.type === "shader") return "Shader";
    const kind = p.type.charAt(0).toUpperCase() + p.type.slice(1);
    return `${kind} gradient: ${p.stops.map((s) => colorText(s.color, s.opacity, notation)).join(" → ")}`;
}

function useCopy(): [boolean, (text: string) => void] {
    const [copied, setCopied] = useState(false);
    return [
        copied,
        (text) => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 900);
        },
    ];
}

// A 24pt row: the label in a 96pt column, then the value (click it to copy).
function Value({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
    const [copied, copy] = useCopy();
    return (
        <button type="button" title="Click to copy" onClick={() => copy(value)} className="grid h-6 w-full grid-cols-[96px_1fr] items-center rounded-[5px] px-4 text-left outline-none hover:bg-panel-hover focus-visible:bg-panel-hover">
            <span className="text-ink-muted">{label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
                {swatch && <span className="size-3 shrink-0 rounded-[2px] border border-black/15" style={{ background: swatch }} />}
                <span className="truncate text-ink">{copied ? "Copied" : value}</span>
            </span>
        </button>
    );
}

// A colour row: a 16pt swatch and the value in the chosen notation.
function ColorRow({ value, swatch }: { value: string; swatch?: string }) {
    const [copied, copy] = useCopy();
    return (
        <button type="button" title="Click to copy" onClick={() => copy(value)} className="flex h-8 w-full items-center gap-4 px-4 text-left outline-none hover:bg-panel-hover focus-visible:bg-panel-hover">
            <span className="size-4 shrink-0 rounded-[3px] border border-black/10 bg-field" style={swatch ? { background: swatch } : undefined} />
            <span className="min-w-0 flex-1 truncate text-ink">{copied ? "Copied" : value}</span>
        </button>
    );
}

// A section: a 40pt title row (with optional controls on the right), its rows, and a rule.
function Block({ title, extra, copyText, children }: { title: string; extra?: React.ReactNode; copyText?: string; children?: React.ReactNode }) {
    const [copied, copy] = useCopy();
    return (
        <section className={`border-b border-panel-border ${children ? "pb-3" : ""}`}>
            <div className="flex h-10 items-center gap-2 pr-2 pl-4">
                <h3 className="min-w-0 flex-1 truncate font-semibold text-ink">{title}</h3>
                {extra}
                {copyText !== undefined && (
                    <button type="button" aria-label={copied ? "Copied" : `Copy ${title.toLowerCase()}`} title={copied ? "Copied" : "Copy"} onClick={() => copy(copyText)} className="flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

const px = (n: number) => `${r(n)}px`;

export function ViewerProperties({ nodes }: { nodes: SceneNode[] }) {
    const [notation, setNotation] = useState<Notation>(lastNotation);
    const [exports, setExports] = useState<{ format: ExportFormat; scale: number }[]>([]);
    const doc = useEditor((s) => s.doc);
    const node = nodes[0];
    if (!node) return <p className="px-4 py-3 text-ink-muted">Select a layer to see its properties.</p>;
    if (nodes.length > 1) return <p className="px-4 py-3 text-ink-muted">{nodes.length} layers selected. Select one layer to see its properties.</p>;
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const fills = node.fills.filter((p) => p.visible);
    const strokes = node.strokes.filter((p) => p.visible);
    const effects = effectsOf(node).filter((e) => e.visible);
    const l = node.layout;
    // The instance this layer is (or sits in), for the Parent component link.
    let instance: SceneNode | undefined = node;
    while (instance && instance.type !== "instance") instance = instance.parentId ? doc.nodes[instance.parentId] : undefined;
    const main = instance?.componentId ? doc.nodes[instance.componentId] : undefined;
    const top = node.y - (parent && parent.type !== "page" ? parent.y : 0);
    const left = node.x - (parent && parent.type !== "page" ? parent.x : 0);
    const layout: [string, string][] = [
        ["Width", px(node.w)],
        ["Height", px(node.h)],
        ["Top", px(top)],
        ["Left", px(left)],
        ...(node.rotation !== 0 ? ([["Rotation", `${r(node.rotation)}°`]] as [string, string][]) : []),
        ...(node.opacity < 1 ? ([["Opacity", pct(node.opacity)]] as [string, string][]) : []),
        ...(node.radius > 0 || node.radii ? ([["Radius", node.radii ? node.radii.map(px).join(" ") : px(node.radius)]] as [string, string][]) : []),
        ...(node.blendMode !== "pass-through" && node.blendMode !== "normal" ? ([["Blend", node.blendMode]] as [string, string][]) : []),
    ];
    const colors = fills.map((p) => ({ text: paintText(p, notation), swatch: p.type === "solid" ? p.color : undefined }));
    const Icon = layerIcon(node);
    return (
        <div className="text-[11px]">
            <div className="flex h-10 items-center gap-2 border-b border-panel-border px-4">
                {createElement(Icon, { className: "size-3.5 shrink-0" })}
                <span className="min-w-0 flex-1 truncate font-semibold">{node.name}</span>
            </div>
            {instance && main && (
                <Block title={instance.id === node.id ? "Main component" : "Parent component"}>
                    <button
                        type="button"
                        onClick={() => {
                            editor.set({ selection: [instance.id] });
                            goToMainComponent();
                        }}
                        className="h-6 w-full truncate px-4 text-left text-[#9747FF] hover:underline"
                    >
                        {main.name}
                    </button>
                </Block>
            )}
            <Block title="Layout" copyText={layout.map(([k, v]) => `${k.toLowerCase()}: ${v};`).join("\n")}>
                {layout.map(([k, v]) => (
                    <Value key={k} label={k} value={v} />
                ))}
            </Block>
            {l && (
                <Block title="Auto layout">
                    <Value label="Direction" value={l.grid ? "Grid" : l.wrap ? "Wrap" : l.direction === "horizontal" ? "Horizontal" : "Vertical"} />
                    <Value label="Gap" value={l.primary === "between" ? "Auto" : px(l.gap)} />
                    <Value label="Padding" value={l.padding.map(px).join(" ")} />
                </Block>
            )}
            {node.type === "text" && (
                <Block title="Typography">
                    <Value label="Font" value={node.fontFamily ?? "Inter"} />
                    <Value label="Weight" value={String(node.fontWeight ?? 400)} />
                    <Value label="Size" value={px(node.fontSize ?? 12)} />
                    <Value label="Line height" value={node.lineHeight ? `${pct(node.lineHeight)}` : "Auto"} />
                    <Value label="Letter" value={`${r(node.letterSpacing ?? 0)}%`} />
                </Block>
            )}
            {(colors.length > 0 || strokes.length > 0 || effects.length > 0) && (
                <Block
                    title="Colors"
                    copyText={colors.map((c) => c.text).join("\n")}
                    extra={
                        <Select
                            aria-label="Colour format"
                            value={notation}
                            onChange={(e) => {
                                lastNotation = e.target.value as Notation;
                                setNotation(lastNotation);
                            }}
                            className="h-6 rounded-[5px] border border-panel-border bg-transparent px-1.5 text-ink outline-none"
                        >
                            <option value="hex">Hex</option>
                            <option value="rgb">RGB</option>
                            <option value="css">CSS</option>
                            <option value="hsl">HSL</option>
                            <option value="hsb">HSB</option>
                        </Select>
                    }
                >
                    {colors.map((c, i) => (
                        <ColorRow key={i} value={c.text} swatch={c.swatch} />
                    ))}
                </Block>
            )}
            {strokes.length > 0 && (
                <Block title="Borders">
                    <Value label="Weight" value={node.strokeWeights ? node.strokeWeights.map(px).join(" ") : px(node.strokeWidth)} />
                    <Value label="Position" value={node.strokeAlign === "inside" ? "Inside" : node.strokeAlign === "outside" ? "Outside" : "Center"} />
                    {node.dash && <Value label="Style" value={node.dash[0] === 0 ? "Dotted" : `Dashed ${node.dash.map(r).join(", ")}`} />}
                    {strokes.map((p, i) => (
                        <Value key={i} label={strokes.length > 1 ? `Colour ${i + 1}` : "Colour"} value={paintText(p, notation)} swatch={p.type === "solid" ? p.color : undefined} />
                    ))}
                </Block>
            )}
            {effects.length > 0 && (
                <Block title="Effects">
                    {effects.map((e, i) => (
                        <Value
                            key={i}
                            label={EFFECT_LABELS[e.type]}
                            value={e.type === "drop-shadow" || e.type === "inner-shadow" ? `${r(e.x)} ${r(e.y)} ${r(e.blur)} ${r(e.spread)} ${colorText(e.color, e.opacity, notation)}` : `${r(e.blur)}`}
                            swatch={e.type === "drop-shadow" || e.type === "inner-shadow" ? e.color : undefined}
                        />
                    ))}
                </Block>
            )}
            <Block
                title="Export"
                extra={
                    <button type="button" aria-label="Add export setting" onClick={() => setExports((x) => [...x, { format: "png", scale: 1 }])} className="flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500">
                        <Plus className="size-4" />
                    </button>
                }
            >
                {exports.length > 0 && (
                    <div className="space-y-2 px-4">
                        {exports.map((x, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <Select aria-label="Export scale" value={String(x.scale)} onChange={(e) => setExports((all) => all.map((y, j) => (j === i ? { ...y, scale: Number(e.target.value) } : y)))} className="h-6 w-16 rounded-[5px] bg-field px-1.5 text-ink outline-none">
                                    {[0.5, 1, 2, 3, 4].map((n) => (
                                        <option key={n} value={n}>
                                            {n}x
                                        </option>
                                    ))}
                                </Select>
                                <Select aria-label="Export format" value={x.format} onChange={(e) => setExports((all) => all.map((y, j) => (j === i ? { ...y, format: e.target.value as ExportFormat } : y)))} className="h-6 flex-1 rounded-[5px] bg-field px-1.5 text-ink outline-none">
                                    <option value="png">PNG</option>
                                    <option value="jpg">JPG</option>
                                    <option value="svg">SVG</option>
                                    <option value="pdf">PDF</option>
                                </Select>
                                <button type="button" aria-label="Remove export setting" onClick={() => setExports((all) => all.filter((_, j) => j !== i))} className="flex size-6 items-center justify-center rounded-[5px] text-ink outline-none hover:bg-panel-hover">
                                    <Minus className="size-4" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                if (refuseExport()) return;
                                void (async () => {
                                    for (const x of exports) await exportLayers(doc, [node.id], x.format, x.scale);
                                })().catch((e: unknown) => editor.notify(e instanceof Error ? e.message : String(e)));
                            }}
                            className="h-6 w-full rounded-[5px] border border-panel-border text-ink outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                            Export {node.name}
                        </button>
                    </div>
                )}
            </Block>
        </div>
    );
}

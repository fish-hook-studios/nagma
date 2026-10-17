import { Check, Grid01, List, SearchSm, XClose } from "@untitledui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { type HSV, hexToRgb, hslToRgb, hsvToRgb, isHex, normalizeHex, rgbToHex, rgbToHsl, rgbToHsv } from "../engine/color";
import { editor, useEditor } from "../engine/store";
import { contrastCurves, flatten, luminance, ratioOf, thresholds } from "../engine/contrast";
import { stylesOf } from "../engine/styles";
import { collectionsOf, resolveVariable } from "../engine/variables";
import { swatchCss } from "../engine/paint";
import type { Paint, SceneNode } from "../engine/types";
import { pickerSwatches } from "./picker-swatches";
import { EyedropperIcon } from "./toolbar-icons";
import { Select } from "./select";

// The colour picker laid out like the reference's: a saturation/brightness square, then the eyedropper
// beside the hue and opacity sliders, then a notation dropdown (Hex, RGB, CSS, HSL, HSB) with
// its fields. `onPreview` fires while dragging; `onChange` commits.

type Notation = "hex" | "rgb" | "css" | "hsl" | "hsb";
const NOTATIONS: { id: Notation; label: string }[] = [
    { id: "hex", label: "Hex" },
    { id: "rgb", label: "RGB" },
    { id: "css", label: "CSS" },
    { id: "hsl", label: "HSL" },
    { id: "hsb", label: "HSB" },
];
let lastNotation: Notation = "hex";

const field = "h-6 min-w-0 border border-transparent bg-field px-2 text-ink outline-none focus:border-brand-500";
const CHECKER = "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px";

// The Libraries tab: colour styles and colour variables the paint can follow.
export interface ColorLibrary {
    // The layer the paint belongs to, for resolving variable values in its mode.
    node: SceneNode | null;
    style: string | null;
    variable: string | null;
    onStyle: (id: string) => void;
    onVariable: (id: string) => void;
}

// Contrast against what the layer sits on (WCAG), shown under the fields and as a line on the square.
export interface ContrastInfo {
    backdrop: string;
    node: SceneNode | null;
}

export function ColorPicker({ color, opacity = 1, onChange, onPreview, showOpacity = true, library, contrast }: { color: string; opacity?: number; onChange: (color: string, opacity: number) => void; onPreview?: (color: string, opacity: number) => void; showOpacity?: boolean; library?: ColorLibrary; contrast?: ContrastInfo }) {
    const [tab, setTab] = useState<"custom" | "libraries">(() => (library && (library.style || library.variable) ? "libraries" : "custom"));
    return (
        <div className="w-full select-none">
            {library && (
                <div className="mb-3 flex gap-1" role="tablist" aria-label="Colour source">
                    {(["custom", "libraries"] as const).map((t) => (
                        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-6 rounded-md px-2 font-medium ${tab === t ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                            {t === "custom" ? "Custom" : "Libraries"}
                        </button>
                    ))}
                </div>
            )}
            {library && tab === "libraries" ? <LibraryTab library={library} /> : <CustomPicker color={color} opacity={opacity} onChange={onChange} onPreview={onPreview} showOpacity={showOpacity} contrast={contrast} />}
        </div>
    );
}

function CustomPicker({ color, opacity = 1, onChange, onPreview, showOpacity = true, contrast }: { color: string; opacity?: number; onChange: (color: string, opacity: number) => void; onPreview?: (color: string, opacity: number) => void; showOpacity?: boolean; contrast?: ContrastInfo }) {
    // Hue and saturation survive a round trip through black or white, so keep HSV as the working state.
    const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(color)));
    const [notation, setNotation] = useState<Notation>(lastNotation);
    const lastEmitted = useRef(color);
    useEffect(() => {
        if (normalizeHex(color) !== normalizeHex(lastEmitted.current)) setHsv(rgbToHsv(hexToRgb(color)));
    }, [color]);
    const hex = rgbToHex(hsvToRgb(hsv));
    const emit = (next: HSV, alpha: number, commit: boolean) => {
        setHsv(next);
        const h = rgbToHex(hsvToRgb(next));
        lastEmitted.current = h;
        if (commit) onChange(h, alpha);
        else onPreview?.(h, alpha);
    };
    const square = useRef<HTMLDivElement>(null);
    const pick = (event: React.PointerEvent, commit: boolean) => {
        const r = square.current?.getBoundingClientRect();
        if (!r) return;
        const s = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
        const v = 1 - Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
        emit({ ...hsv, s, v }, opacity, commit);
    };
    const hueColor = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb);
    const setFromHex = (text: string) => {
        if (isHex(text)) emit(rgbToHsv(hexToRgb(text)), opacity, true);
    };
    const pct = Math.round(opacity * 100);
    const eyedrop = () => {
        editor.set({ tool: "eyedropper", pickColorInto: (picked) => emit(rgbToHsv(hexToRgb(picked)), opacity, true) });
    };
    return (
        <div>
            <div
                ref={square}
                role="slider"
                aria-label="Saturation and brightness"
                aria-valuenow={Math.round(hsv.v * 100)}
                tabIndex={0}
                className="relative aspect-square w-full cursor-crosshair rounded-[3px]"
                style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pick(e, false);
                }}
                onPointerMove={(e) => e.buttons === 1 && pick(e, false)}
                onPointerUp={(e) => pick(e, true)}
            >
                {contrast && <ContrastLines hue={hsv.h} contrast={contrast} />}
                <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.3)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
            </div>
            {/* The eyedropper beside the hue and opacity sliders (165 × 14, on a 28pt pitch). */}
            <div className="mt-3.5 flex items-center">
                <AriaButton aria-label="Eyedropper" onPress={eyedrop} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                    <EyedropperIcon className="size-4" />
                </AriaButton>
                <div className="ml-auto flex w-[165px] flex-col gap-3.5">
                    <input
                        type="range"
                        min={0}
                        max={360}
                        value={Math.round(hsv.h)}
                        aria-label="Hue"
                        onChange={(e) => emit({ ...hsv, h: Number(e.target.value) }, opacity, false)}
                        onPointerUp={() => emit(hsv, opacity, true)}
                        onKeyUp={() => emit(hsv, opacity, true)}
                        className="picker-slider"
                        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)", "--thumb": hueColor } as React.CSSProperties}
                    />
                    {showOpacity && (
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={pct}
                            aria-label="Opacity"
                            onChange={(e) => {
                                onPreview?.(hex, Number(e.target.value) / 100);
                            }}
                            onPointerUp={(e) => onChange(hex, Number((e.target as HTMLInputElement).value) / 100)}
                            onKeyUp={(e) => onChange(hex, Number((e.target as HTMLInputElement).value) / 100)}
                            className="picker-slider"
                            style={{ background: `linear-gradient(to right, transparent, ${hex}), ${CHECKER}`, "--thumb": `color-mix(in srgb, ${hex} ${pct}%, transparent)` } as React.CSSProperties}
                        />
                    )}
                </div>
            </div>
            {/* Notation, then its fields joined into one 24pt field. */}
            <div className="mt-3.5 flex h-6 items-center gap-2">
                <Select
                    aria-label="Colour notation"
                    value={notation}
                    onChange={(e) => {
                        lastNotation = e.target.value as Notation;
                        setNotation(lastNotation);
                    }}
                    className="h-6 w-[54px] shrink-0 rounded-md border border-panel-border pl-[5px] text-ink outline-none hover:border-ink-subtle"
                >
                    {NOTATIONS.map((n) => (
                        <option key={n.id} value={n.id}>
                            {n.label}
                        </option>
                    ))}
                </Select>
                <div className="flex h-6 min-w-0 flex-1 gap-px overflow-hidden rounded-md">
                    {notation === "hex" && <HexField value={hex} onCommit={setFromHex} />}
                    {notation === "rgb" && (["r", "g", "b"] as const).map((k) => <NumField key={k} value={Math.round(rgb[k])} max={255} label={k.toUpperCase()} onCommit={(v) => emit(rgbToHsv({ ...rgb, [k]: v }), opacity, true)} />)}
                    {notation === "css" && <input readOnly aria-label="CSS colour" value={opacity < 1 ? `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${Math.round(opacity * 100) / 100})` : hex} onFocus={(e) => e.currentTarget.select()} className={`${field} min-w-0 flex-1 font-mono text-[10px]`} />}
                    {notation === "hsl" && (
                        <>
                            <NumField value={Math.round(hsl.h)} max={360} label="H" onCommit={(v) => emit(rgbToHsv(hslToRgb({ ...hsl, h: v })), opacity, true)} />
                            <NumField value={Math.round(hsl.s * 100)} max={100} label="S" onCommit={(v) => emit(rgbToHsv(hslToRgb({ ...hsl, s: v / 100 })), opacity, true)} />
                            <NumField value={Math.round(hsl.l * 100)} max={100} label="L" onCommit={(v) => emit(rgbToHsv(hslToRgb({ ...hsl, l: v / 100 })), opacity, true)} />
                        </>
                    )}
                    {notation === "hsb" && (
                        <>
                            <NumField value={Math.round(hsv.h)} max={360} label="H" onCommit={(v) => emit({ ...hsv, h: v }, opacity, true)} />
                            <NumField value={Math.round(hsv.s * 100)} max={100} label="S" onCommit={(v) => emit({ ...hsv, s: v / 100 }, opacity, true)} />
                            <NumField value={Math.round(hsv.v * 100)} max={100} label="B" onCommit={(v) => emit({ ...hsv, v: v / 100 }, opacity, true)} />
                        </>
                    )}
                    {showOpacity && notation !== "css" && <PctField value={pct} label="Opacity" onCommit={(v) => onChange(hex, v / 100)} />}
                </div>
            </div>
            {contrast && <ContrastRow color={hex} opacity={opacity} contrast={contrast} onPick={(fixed) => emit(rgbToHsv(hexToRgb(fixed)), opacity, true)} />}
            <ProfileNote />
            <Swatches current={hex} onPick={(picked, alpha) => emit(rgbToHsv(hexToRgb(picked)), showOpacity && alpha !== undefined ? alpha : opacity, true)} />
        </div>
    );
}

// Which colour profile the values are in: the file's setting, which this menu also changes (the
// no-selection panel's Color profile section moved here; exports follow it by default).
function ProfileNote() {
    const profile = useEditor((s) => s.doc.colorProfile ?? "srgb");
    return (
        <div className="mt-1.5 flex justify-end">
            <Select
                aria-label="File colour profile"
                title="File colour profile"
                value={profile}
                onChange={(e) => editor.execute({ type: "doc.settings", patch: { colorProfile: e.target.value as "srgb" | "p3" } })}
                className="h-5 rounded-md pl-1 text-[10px] text-ink-subtle hover:bg-panel-hover hover:text-ink"
            >
                <option value="srgb">sRGB</option>
                <option value="p3">Display P3</option>
            </Select>
        </div>
    );
}

// The swatches under a rule: "On this page" (the solid colours used on the current page, most used
// first) or the product's own set, chosen from an outlined menu; 15pt swatches on a 24pt pitch.
let lastSwatchSource: "page" | "product" = "page";

function Swatches({ current, onPick }: { current: string; onPick: (color: string, opacity?: number) => void }) {
    const doc = useEditor((s) => s.doc);
    const nodes = doc.nodes;
    const pageId = useEditor((s) => s.pageId);
    const product = pickerSwatches()?.(doc);
    const [source, setSource] = useState<"page" | "product">(lastSwatchSource);
    const pageColors = useMemo(() => {
        const count = new Map<string, { color: string; opacity: number; n: number }>();
        const visit = (id: string) => {
            const node = nodes[id];
            if (!node) return;
            for (const p of [...node.fills, ...node.strokes, ...(node.spans ?? []).flatMap((sp) => sp.fills ?? [])]) {
                if (p.type !== "solid" || !p.visible) continue;
                const color = normalizeHex(p.color);
                const key = `${color}|${p.opacity}`;
                const hit = count.get(key);
                if (hit) hit.n++;
                else count.set(key, { color, opacity: p.opacity, n: 1 });
            }
            for (const child of node.children) visit(child);
        };
        for (const id of nodes[pageId]?.children ?? []) visit(id);
        return [...count.values()].sort((a, b) => b.n - a.n).slice(0, 27);
    }, [nodes, pageId]);
    const hasProduct = Boolean(product?.colors.length);
    const shown = source === "product" && hasProduct ? "product" : "page";
    if (!pageColors.length && !hasProduct) return null;
    const swatch = "size-[15px] overflow-hidden rounded-[3px] outline-none";
    const ring = (color: string) => (normalizeHex(current) === normalizeHex(color) ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-panel-raised" : "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] hover:ring-1 hover:ring-ink-subtle");
    return (
        <div className="-mx-4 mt-4 border-t border-panel-border px-4 pt-3.5">
            <Select
                aria-label="Swatches"
                value={shown}
                onChange={(e) => {
                    lastSwatchSource = e.target.value as "page" | "product";
                    setSource(lastSwatchSource);
                }}
                className="h-6 w-full rounded-md border border-panel-border pl-2 text-ink outline-none hover:border-ink-subtle"
            >
                <option value="page">On this page</option>
                {hasProduct && <option value="product">{product?.title}</option>}
            </Select>
            <div className="mt-2 grid grid-cols-[repeat(9,15px)] gap-x-[9px] gap-y-[9px]">
                {shown === "product"
                    ? product?.colors.map((c) => <button key={`${c.name}|${c.color}`} type="button" title={c.name} aria-label={`Use ${c.name}`} onClick={() => onPick(c.color)} className={`${swatch} ${ring(c.color)}`} style={{ background: c.color }} />)
                    : pageColors.map((c) => (
                          <button
                              key={`${c.color}|${c.opacity}`}
                              type="button"
                              title={`${c.color.replace("#", "").toUpperCase()}${c.opacity < 1 ? ` ${Math.round(c.opacity * 100)}%` : ""}`}
                              aria-label={`Use ${c.color.replace("#", "")}${c.opacity < 1 ? ` at ${Math.round(c.opacity * 100)}%` : ""}`}
                              onClick={() => onPick(c.color, c.opacity)}
                              className={`${swatch} ${ring(c.color)}`}
                              style={{ background: CHECKER }}
                          >
                              <span className="block size-full" style={{ background: c.color, opacity: c.opacity }} />
                          </button>
                      ))}
            </div>
        </div>
    );
}

// The pass line for AA (solid) and AAA (dashed) through the square, for the current hue.
function ContrastLines({ hue, contrast }: { hue: number; contrast: ContrastInfo }) {
    const t = thresholds(contrast.node);
    const lines = useMemo(() => {
        const out: { d: string; dashed: boolean }[] = [];
        for (const [ratio, dashed] of [[t.aa, false], [t.aaa, true]] as const) {
            const { dark, light } = contrastCurves(hue, contrast.backdrop, ratio, 40);
            for (const pts of [dark, light]) if (pts.length > 1) out.push({ d: pts.map((p, i) => `${i ? "L" : "M"}${(p.s * 100).toFixed(2)} ${((1 - p.v) * 100).toFixed(2)}`).join(" "), dashed });
        }
        return out;
    }, [hue, contrast.backdrop, t.aa, t.aaa]);
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
            {lines.map((l, i) => (
                <path key={i} d={l.d} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.2} strokeDasharray={l.dashed ? "3 3" : undefined} vectorEffect="non-scaling-stroke" style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.6))" }} />
            ))}
        </svg>
    );
}

function Badge({ label, pass }: { label: string; pass: boolean }) {
    return (
        <span className={`flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${pass ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`} title={pass ? `Passes ${label}` : `Fails ${label}`}>
            {pass ? <Check className="size-3" /> : <XClose className="size-3" />}
            {label}
        </span>
    );
}

// The contrast target: what the text size says, or Normal, Large or Graphics (3:1 for AA) chosen by hand.
type ContrastMode = "auto" | "normal" | "large" | "graphics";
let lastContrastMode: ContrastMode = "auto";

function thresholdsFor(mode: ContrastMode, node: SceneNode | null): { aa: number; aaa: number; large: boolean } {
    if (mode === "normal") return { aa: 4.5, aaa: 7, large: false };
    if (mode === "large") return { aa: 3, aaa: 4.5, large: true };
    if (mode === "graphics") return { aa: 3, aaa: 4.5, large: true };
    return thresholds(node);
}

// The nearest colour of the same hue and saturation that passes AA: its brightness moves away from
// the backdrop until the ratio is met.
function correctFor(hex: string, opacity: number, backdrop: string, target: number): string {
    const hsv = rgbToHsv(hexToRgb(hex));
    const bg = luminance(backdrop);
    const passes = (v: number) => ratioOf(luminance(flatten(rgbToHex(hsvToRgb({ ...hsv, v })), opacity, backdrop)), bg) >= target;
    // Try darker, then lighter, taking the smaller change.
    const search = (dir: 1 | -1) => {
        let lo = hsv.v;
        let hi = dir > 0 ? 1 : 0;
        if (!passes(hi)) return null;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (passes(mid)) hi = mid;
            else lo = mid;
        }
        return hi;
    };
    const up = search(1);
    const down = search(-1);
    const pick = up !== null && down !== null ? (Math.abs(up - hsv.v) <= Math.abs(down - hsv.v) ? up : down) : (up ?? down);
    return pick === null ? hex : rgbToHex(hsvToRgb({ ...hsv, v: pick }));
}

function ContrastRow({ color, opacity, contrast, onPick }: { color: string; opacity: number; contrast: ContrastInfo; onPick?: (hex: string) => void }) {
    const [mode, setMode] = useState<ContrastMode>(lastContrastMode);
    const t = thresholdsFor(mode, contrast.node);
    const ratio = ratioOf(luminance(flatten(color, opacity, contrast.backdrop)), luminance(contrast.backdrop));
    const shown = Math.floor(ratio * 100) / 100;
    const fixed = ratio < t.aa ? correctFor(color, opacity, contrast.backdrop, t.aa) : null;
    return (
        <div className="mt-3 space-y-1.5 border-t border-panel-border pt-2.5" title={`Against ${contrast.backdrop}. The solid line on the square marks AA, the dashed line AAA.`}>
            <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-ink-muted">Contrast</span>
                <span className="size-3.5 shrink-0 rounded-sm border border-black/20" style={{ background: contrast.backdrop }} aria-label={`Backdrop ${contrast.backdrop}`} />
                {fixed && onPick ? (
                    <button type="button" onClick={() => onPick(fixed)} title={`Click to use ${fixed}, the nearest colour that passes AA`} className="min-w-0 flex-1 text-left font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-brand-500">
                        {shown.toFixed(2)}:1
                    </button>
                ) : (
                    <span className="min-w-0 flex-1 font-medium tabular-nums">{shown.toFixed(2)}:1</span>
                )}
                <Badge label="AA" pass={ratio >= t.aa} />
                <Badge label="AAA" pass={ratio >= t.aaa} />
            </div>
            <Select aria-label="Contrast target" value={mode} onChange={(e) => { lastContrastMode = e.target.value as ContrastMode; setMode(lastContrastMode); }} className="h-6 w-full rounded-md bg-field px-2 text-ink outline-none hover:bg-panel-hover">
                <option value="auto">{contrast.node?.type === "text" ? (thresholds(contrast.node).large ? "Large text (auto)" : "Normal text (auto)") : "Text (auto)"}</option>
                <option value="normal">Normal text</option>
                <option value="large">Large text</option>
                <option value="graphics">Graphics and UI</option>
            </Select>
        </div>
    );
}

let libraryView: "list" | "grid" = "list";

// Styles and variables of the file, searchable, as a list or a grid of swatches.
export function LibraryTab({ library }: { library: ColorLibrary }) {
    const doc = useEditor((s) => s.doc);
    const [query, setQuery] = useState("");
    const [view, setView] = useState(libraryView);
    const q = query.trim().toLowerCase();
    const groups = useMemo(() => {
        const out: { title: string; items: { id: string; kind: "style" | "variable"; name: string; path: string; paint: Paint }[] }[] = [];
        for (const c of collectionsOf(doc)) {
            const items = c.variables
                .filter((v) => v.type === "color" && !v.hidden)
                .map((v) => {
                    const r = resolveVariable(doc, v.id, library.node);
                    const value = typeof r?.value === "string" ? r.value : "#000000";
                    return { id: v.id, kind: "variable" as const, name: v.name.split("/").pop() ?? v.name, path: v.name, paint: { type: "solid" as const, color: value.slice(0, 7), opacity: 1, visible: true, blend: "normal" as const } };
                });
            if (items.length) out.push({ title: c.name, items });
        }
        const styles = stylesOf(doc).colors.map((st) => ({ id: st.id, kind: "style" as const, name: st.name.split("/").pop() ?? st.name, path: st.name, paint: st.paint }));
        if (styles.length) out.push({ title: "Colour styles", items: styles });
        return out
            .map((g) => ({ ...g, items: g.items.filter((it) => !q || it.path.toLowerCase().includes(q) || g.title.toLowerCase().includes(q)) }))
            .filter((g) => g.items.length);
    }, [doc, q, library.node]);
    const pick = (it: { id: string; kind: "style" | "variable" }) => (it.kind === "style" ? library.onStyle(it.id) : library.onVariable(it.id));
    const isCurrent = (it: { id: string; kind: "style" | "variable" }) => (it.kind === "style" ? library.style === it.id : library.variable === it.id);
    const setMode = (v: "list" | "grid") => {
        libraryView = v;
        setView(v);
    };
    return (
        <div>
            <div className="flex items-center gap-1">
                <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-field px-2 text-ink-muted">
                    <SearchSm className="size-3.5 shrink-0" />
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search" aria-label="Search colours" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle" />
                </label>
                <button type="button" aria-label={view === "list" ? "Show as grid" : "Show as list"} title={view === "list" ? "Show as grid" : "Show as list"} onClick={() => setMode(view === "list" ? "grid" : "list")} className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-panel-hover hover:text-ink">
                    {view === "list" ? <Grid01 className="size-3.5" /> : <List className="size-3.5" />}
                </button>
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto">
                {groups.length === 0 && <p className="px-1 py-3 text-center text-ink-muted">{q ? "No matching colours" : "No colour styles or variables in this file yet"}</p>}
                {groups.map((g) => (
                    <div key={g.title} className="mb-2">
                        <div className="px-1 py-1 text-[10px] font-semibold text-ink-subtle">{g.title}</div>
                        {view === "grid" ? (
                            <div className="grid grid-cols-8 gap-1 px-1">
                                {g.items.map((it) => (
                                    <button key={it.id} type="button" title={it.path} aria-label={it.path} onClick={() => pick(it)} className={`size-6 rounded border outline-none ${isCurrent(it) ? "border-brand-500 ring-1 ring-brand-500" : "border-black/15 hover:border-ink-muted"}`} style={{ background: swatchCss(it.paint, doc.images) }} />
                                ))}
                            </div>
                        ) : (
                            g.items.map((it) => (
                                <button key={it.id} type="button" onClick={() => pick(it)} title={it.path} className={`flex h-7 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-panel-hover ${isCurrent(it) ? "bg-panel-hover" : ""}`}>
                                    <span className={`size-4 shrink-0 border border-black/15 ${it.kind === "variable" ? "rounded-full" : "rounded"}`} style={{ background: swatchCss(it.paint, doc.images) }} />
                                    <span className="min-w-0 flex-1 truncate">{it.path}</span>
                                    {isCurrent(it) && <Check className="size-3.5 text-brand-500" />}
                                </button>
                            ))
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function HexField({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            aria-label="Hex colour"
            value={draft ?? value.replace("#", "")}
            onFocus={(e) => {
                setDraft(value.replace("#", ""));
                e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft !== null) onCommit(draft);
                setDraft(null);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={`${field} min-w-0 flex-1 uppercase`}
        />
    );
}

function NumField({ value, max, label, onCommit }: { value: number; max: number; label: string; onCommit: (v: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            aria-label={label}
            title={label}
            value={draft ?? String(value)}
            onFocus={(e) => {
                setDraft(String(value));
                e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                const n = Number(draft);
                if (draft !== null && Number.isFinite(n)) onCommit(Math.max(0, Math.min(max, n)));
                setDraft(null);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                // Arrow keys step the value (⇧ by ten).
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const delta = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
                    const next = Math.max(0, Math.min(max, (draft !== null && Number.isFinite(Number(draft)) ? Number(draft) : value) + delta));
                    setDraft(null);
                    onCommit(next);
                }
            }}
            className={`${field} w-0 min-w-0 flex-1 px-1 text-center`}
        />
    );
}

function PctField({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
    return (
        <div className="flex h-6 w-[54px] shrink-0 items-center bg-field pr-2">
            <NumField value={value} max={100} label={label} onCommit={onCommit} />
            <span className="text-ink-subtle">%</span>
        </div>
    );
}

// A swatch that opens the picker: the drop-in for every colour field outside the paint rows.
export function ColorSwatch({ color, opacity, onChange, onPreview, label = "Colour", size = 6, placement = "left top", showOpacity }: { color: string; opacity?: number; onChange: (color: string, opacity: number) => void; onPreview?: (color: string, opacity: number) => void; label?: string; size?: 3.5 | 4 | 5 | 6 | 8; placement?: "left top" | "bottom start" | "bottom end" | "top"; showOpacity?: boolean }) {
    const box = size === 3.5 ? "size-3.5 rounded-sm" : size === 4 ? "size-4" : size === 5 ? "size-5" : size === 8 ? "size-8 rounded-lg" : "size-6";
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label={label} className={`${box} shrink-0 overflow-hidden rounded border border-black/20 outline-none focus-visible:ring-2 focus-visible:ring-brand-500`} style={{ background: `linear-gradient(${color}, ${color}), ${CHECKER}`, opacity: 1 }}>
                <span className="block size-full" style={{ background: color, opacity: opacity ?? 1 }} />
            </AriaButton>
            <AriaPopover placement={placement} offset={8} className="w-60 rounded-xl border border-panel-border bg-panel-raised p-4 text-ink shadow-xl outline-none">
                <AriaDialog className="outline-none" aria-label={label}>
                    <ColorPicker color={color} opacity={opacity ?? 1} onChange={onChange} onPreview={onPreview} showOpacity={showOpacity ?? opacity !== undefined} />
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

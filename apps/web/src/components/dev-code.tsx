import { ChevronDown, Settings01 } from "@untitledui/icons";
import { worldBounds } from "../engine/transform";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { cssFor } from "../engine/dev-css";
import { allLangs, type CodeLang, copyText, type CodeSettings, type CodeUnit, UNIT_LABELS, codeBlocks, defaultScale, formatLength, langInfo, normalizeSettings, saveCodeSettings } from "../engine/dev-code";
import { generateCode, parsePluginLang, usePlugins } from "../engine/plugins";
import { layerTextCss, richTextBlocks } from "../engine/text-code";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { Select } from "./select";

// Inspect's Code section: the language and unit (with its scale), a box model or a type preview,
// then the snippets, each with Copy; or the same properties as a list of values to copy.

const select = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border";

export function CodeSettingsControls({ settings, onChange }: { settings: CodeSettings; onChange: (s: CodeSettings) => void }) {
    // Codegen plugins' languages join the list once the plugins load (re-rendered when they change).
    usePlugins((st) => st.plugins);
    const languages = allLangs();
    const info = langInfo(settings.lang);
    const set = (patch: Partial<CodeSettings>) => {
        const next = normalizeSettings({ ...settings, ...patch });
        saveCodeSettings(next);
        onChange(next);
    };
    return (
        <div className="flex items-center gap-1">
            <Select aria-label="Code language" value={settings.lang} onChange={(e) => {
                    const lang = e.target.value as CodeLang;
                    const unit = langInfo(lang).units[0] as CodeUnit;
                    set({ lang, unit, scale: defaultScale(unit) });
                }} className={select}>
                {(["Web", "iOS", "Android", "Plugins"] as const).filter((platform) => languages.some((l) => l.platform === platform)).map((platform) => (
                    <optgroup key={platform} label={platform}>
                        {languages.filter((l) => l.platform === platform).map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.label}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </Select>
            {info.units.length > 1 && (
                <Select aria-label="Unit" value={settings.unit} onChange={(e) => set({ unit: e.target.value as CodeUnit, scale: defaultScale(e.target.value as CodeUnit) })} className={select}>
                    {info.units.map((u) => (
                        <option key={u} value={u}>
                            {UNIT_LABELS[u]}
                        </option>
                    ))}
                </Select>
            )}
            {settings.unit !== "px" && <UnitScale settings={settings} onChange={(scale) => set({ scale })} />}
        </div>
    );
}

// Set unit scale: the root font size for rem, canvas pixels per point or dp otherwise.
function UnitScale({ settings, onChange }: { settings: CodeSettings; onChange: (scale: number) => void }) {
    const [draft, setDraft] = useState(String(settings.scale));
    const rem = settings.unit === "rem";
    const commit = () => {
        const n = Number(draft);
        if (n > 0 && Number.isFinite(n)) onChange(n);
        else setDraft(String(settings.scale));
    };
    return (
        <AriaDialogTrigger>
            <AriaButton aria-label="Set unit scale" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink">
                <Settings01 className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="bottom end" offset={6} className="w-56 rounded-lg border border-panel-border bg-panel-raised p-3 text-[11px] text-ink shadow-xl outline-none">
                <AriaDialog aria-label="Unit scale" className="space-y-2 outline-none">
                    <div className="font-semibold">Unit scale</div>
                    <p className="text-ink-muted">{rem ? "The root font size: 1rem equals this many pixels." : `Canvas pixels per ${settings.unit}. Use 2 or 3 for designs drawn at @2x or @3x.`}</p>
                    <label className="flex items-center gap-2">
                        <span className="text-ink-muted">{rem ? "1rem =" : `1${settings.unit} =`}</span>
                        <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") commit();
                            }}
                            inputMode="decimal"
                            aria-label="Unit scale"
                            className="h-7 w-16 rounded-md bg-field px-2 outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        <span className="text-ink-muted">px</span>
                    </label>
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}

// The box model: the layer's size inside its padding, border and margin.
function BoxModel({ node, doc, settings }: { node: SceneNode; doc: NagmaDocument; settings: CodeSettings }) {
    const f = (v: number) => formatLength(v, settings);
    const pad = node.layout?.padding ?? [0, 0, 0, 0];
    const border = node.strokes.some((p) => p.visible) && node.strokeWidth > 0 ? (node.strokeWeights ?? [node.strokeWidth, node.strokeWidth, node.strokeWidth, node.strokeWidth]) : [0, 0, 0, 0];
    // Layers have no margins of their own; in a wrapping or stacked auto layout the gap after it is
    // the space it keeps from the next one.
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const siblings = parent?.layout && !parent.layout.grid ? parent.children.filter((id) => doc.nodes[id]?.visible && doc.nodes[id]?.positioning !== "absolute") : [];
    const last = siblings[siblings.length - 1] === node.id;
    const gap = parent?.layout && siblings.includes(node.id) && !last && parent.layout.primary !== "between" ? parent.layout.gap : 0;
    const margin = parent?.layout?.direction === "horizontal" ? [0, gap, 0, 0] : [0, 0, gap, 0];
    // The red tags: how far the layer sits from its parent frame's edges (top, right, bottom, left).
    const frame = parent && parent.type !== "page" ? worldBounds(doc, parent) : null;
    const box = worldBounds(doc, node);
    const position = frame ? [box.y - frame.y, frame.x + frame.w - (box.x + box.w), frame.y + frame.h - (box.y + box.h), box.x - frame.x] : null;
    const value = (v: number | undefined) => (v ? f(v) : "-");
    const edges = (values: number[]) => (
        <>
            <span className="absolute top-1 left-1/2 -translate-x-1/2">{value(values[0])}</span>
            <span className="absolute top-1/2 right-2 -translate-y-1/2">{value(values[1])}</span>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{value(values[2])}</span>
            <span className="absolute top-1/2 left-2 -translate-y-1/2">{value(values[3])}</span>
        </>
    );
    const ring = (label: string, values: number[], cls: string, child: React.ReactNode) => (
        <div className={`relative rounded-[3px] border px-[30px] py-6 ${cls}`}>
            <span className="absolute top-1 left-2 text-ink-muted">-</span>
            <span className="absolute top-1 right-2 text-ink-muted">-</span>
            <span className="absolute top-1 left-[38px] text-ink-muted">{label}</span>
            {edges(values)}
            {child}
        </div>
    );
    const tag = "absolute rounded-[3px] bg-[#E03E1A] px-1 text-[10px] leading-4 font-medium text-white";
    const content = (
        <div className="truncate rounded-[3px] bg-panel-hover px-2 py-[26px] text-center text-ink">
            {node.name} · {f(node.w)} × {f(node.h)}
        </div>
    );
    let inner = pad.some(Boolean) ? ring("Padding", pad, "border-panel-border bg-emerald-500/5", content) : content;
    inner = ring("Border", border, "border-panel-border bg-panel", inner);
    if (margin.some(Boolean)) inner = ring("Margin", margin, "border-amber-500/40 border-dashed", inner);
    return (
        <div className="relative mb-3 rounded-[5px] bg-field px-[33px] pt-[36px] pb-[36px] text-[11px] text-ink-muted" aria-label="Box model">
            {inner}
            {position && (
                <>
                    <span className={`${tag} top-[-1px] left-1/2 -translate-x-1/2 -translate-y-1/2`}>{f(position[0] ?? 0)}</span>
                    <span className={`${tag} top-1/2 right-0 translate-x-1/2 -translate-y-1/2`}>{f(position[1] ?? 0)}</span>
                    <span className={`${tag} bottom-[-1px] left-1/2 -translate-x-1/2 translate-y-1/2`}>{f(position[2] ?? 0)}</span>
                    <span className={`${tag} top-1/2 left-0 -translate-x-1/2 -translate-y-1/2`}>{f(position[3] ?? 0)}</span>
                    <span className="pointer-events-none absolute top-0 left-1/2 h-[36px] w-px bg-[#E03E1A]" />
                    <span className="pointer-events-none absolute bottom-0 left-1/2 h-[36px] w-px bg-[#E03E1A]" />
                    <span className="pointer-events-none absolute top-1/2 left-0 h-px w-[33px] bg-[#E03E1A]" />
                    <span className="pointer-events-none absolute top-1/2 right-0 h-px w-[33px] bg-[#E03E1A]" />
                </>
            )}
            <span className="absolute right-2 bottom-1.5">{node.strokeAlign === "outside" ? "content-box" : "border-box"}</span>
        </div>
    );
}

function TypePreview({ node }: { node: SceneNode }) {
    const size = node.fontSize ?? 16;
    const weightNames: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi bold", 700: "Bold", 800: "Extra bold", 900: "Black" };
    return (
        <div className="mb-2 flex items-center gap-3 rounded-md bg-field p-2">
            <span className="w-12 shrink-0 text-center text-[28px] leading-none text-ink" style={{ fontFamily: node.fontFamily, fontWeight: node.fontWeight, fontStyle: node.italic ? "italic" : undefined }} aria-hidden="true">
                Ag
            </span>
            <div className="min-w-0 text-[11px]">
                <div className="truncate font-medium">{node.fontFamily ?? "Inter"}</div>
                <div className="text-ink-muted">
                    {weightNames[Math.round((node.fontWeight ?? 400) / 100) * 100] ?? node.fontWeight}
                    {node.italic ? " italic" : ""} · {Math.round(size * 100) / 100}px · {node.lineHeight == null ? "Auto" : `${Math.round(node.lineHeight * size * 100) / 100}px`} line
                </div>
            </div>
        </div>
    );
}

export function CodeSection({ node, doc, settings, onSettings }: { node: SceneNode; doc: NagmaDocument; settings: CodeSettings; onSettings: (s: CodeSettings) => void }) {
    const [view, setView] = useState<"code" | "list">("code");
    const connected = connectedCode(doc, node, settings.lang);
    const plugin = usePluginCode(node, doc, settings.lang);
    let blocks = plugin ? plugin.blocks : codeBlocks(node, doc, settings);
    // Rich text: one block per differently styled range.
    if (settings.lang === "css" && node.type === "text") blocks = [...blocks, { title: "Text", lines: layerTextCss(node) }, ...richTextBlocks(node)].filter((g) => g.lines.length);
    const listLines = cssFor(node, doc.images, doc).split("\n").filter(Boolean);
    const [open, setOpen] = useState(true);
    const seg = (on: boolean) => `h-6 rounded-[5px] px-2 ${on ? "border border-panel-border bg-panel text-ink" : "text-ink-muted hover:text-ink"}`;
    return (
        <div className="border-b border-panel-border pr-2 pb-3 pl-4">
            <div className="-ml-3 flex h-10 items-center">
                <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-6 items-center gap-1 rounded-[5px] px-1 font-semibold outline-none">
                    <ChevronDown className={`size-3 text-ink-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                    Layer properties
                </button>
            </div>
            {open && (
            <>
            {node.type === "text" ? <TypePreview node={node} /> : <BoxModel node={node} doc={doc} settings={settings} />}
            {/* List | Code, and the language (and unit) on the right. */}
            <div className="mb-2 flex h-8 items-center justify-between gap-1">
                <div role="radiogroup" aria-label="Show properties as" className="flex h-6 items-center rounded-[5px] bg-field">
                    <button type="button" role="radio" aria-checked={view === "list"} onClick={() => setView("list")} className={seg(view === "list")}>
                        List
                    </button>
                    <button type="button" role="radio" aria-checked={view === "code"} onClick={() => setView("code")} className={seg(view === "code")}>
                        Code
                    </button>
                </div>
                <CodeSettingsControls settings={settings} onChange={onSettings} />
            </div>
            {view === "code" ? (
                <>
                    {connected && (
                        <div className="mb-2">
                            <div className="mb-1 flex items-center justify-between text-ink-muted">
                                <span className="flex items-center gap-1.5">
                                    <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-600">Connected</span>
                                    {connected.source ? (
                                        <a href={connected.source} target="_blank" rel="noreferrer" className="truncate text-brand-500 hover:underline">
                                            {connected.label}
                                        </a>
                                    ) : (
                                        <span className="truncate">{connected.label}</span>
                                    )}
                                </span>
                                <button type="button" onClick={() => void copyText(connected.code)} className="rounded px-1 text-brand-500 hover:bg-panel-hover">
                                    Copy
                                </button>
                            </div>
                            <pre className="overflow-x-auto rounded-md bg-field p-2 font-mono text-[10.5px] leading-4 whitespace-pre text-ink">{connected.code}</pre>
                        </div>
                    )}
                    {plugin?.status && <p className={`mb-2 ${plugin.error ? "text-red-500" : "text-ink-muted"}`}>{plugin.status}</p>}
                    {blocks.map((g) => (
                        <div key={g.title} className="mb-2">
                            <div className="mb-1 flex items-center justify-between text-ink-muted">
                                <span>{connected ? `Generated · ${g.title}` : g.title}</span>
                                <button type="button" onClick={() => void copyText(g.lines.join("\n"))} className="rounded px-1 text-brand-500 hover:bg-panel-hover">
                                    Copy
                                </button>
                            </div>
                            <pre className="overflow-x-auto rounded-md bg-field p-2 font-mono text-[10.5px] leading-4 whitespace-pre text-ink">{g.lines.join("\n")}</pre>
                        </div>
                    ))}
                </>
            ) : (
                <div className="space-y-0.5">
                    {listLines.map((line) => {
                        const [prop, ...rest] = line.replace(/;$/, "").split(":");
                        const value = rest.join(":").trim();
                        return (
                            <button key={line} type="button" onClick={() => void copyText(value)} className="flex h-6 w-full items-center justify-between gap-2 rounded px-1 text-left hover:bg-panel-hover" title="Click to copy">
                                <span className="text-ink-muted">{prop}</span>
                                <span className="min-w-0 truncate text-ink">{value}</span>
                            </button>
                        );
                    })}
                </div>
            )}
            </>
            )}
        </div>
    );
}

// A codegen plugin's code for the layer: asked again when the layer or the file changes, or when
// the plugin asks for a refresh.
function usePluginCode(node: SceneNode, doc: NagmaDocument, lang: CodeLang): { blocks: { title: string; lines: string[] }[]; status: string | null; error: boolean } | null {
    const isPlugin = Boolean(parsePluginLang(lang));
    const [result, setResult] = useState<{ key: string; blocks: { title: string; lines: string[] }[]; error: string | null } | null>(null);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const bump = () => setRefresh((n) => n + 1);
        window.addEventListener("nagma-codegen-refresh", bump);
        return () => window.removeEventListener("nagma-codegen-refresh", bump);
    }, []);
    const key = `${lang}|${node.id}`;
    useEffect(() => {
        if (!isPlugin) return;
        let live = true;
        const timer = window.setTimeout(() => {
            generateCode(lang, node.id).then(
                (list) => live && setResult({ key, blocks: list.map((r) => ({ title: r.title || "Code", lines: r.code.split("\n") })), error: null }),
                (e: unknown) => live && setResult({ key, blocks: [], error: e instanceof Error ? e.message : String(e) }),
            );
        }, 120);
        return () => {
            live = false;
            window.clearTimeout(timer);
        };
    }, [isPlugin, lang, node.id, key, doc, refresh]);
    if (!isPlugin) return null;
    const current = result?.key === key ? result : null;
    if (!current) return { blocks: [], status: "Generating…", error: false };
    if (current.error) return { blocks: [], status: current.error, error: true };
    return { blocks: current.blocks, status: current.blocks.length ? null : "The plugin returned no code for this layer.", error: false };
}

// Connected code: a snippet the design system team attached to a component, shown for its
// instances in place of (above) the generated code. The language picks the snippet for it, or the
// first one.
function connectedCode(doc: NagmaDocument, node: SceneNode, lang: CodeLang): { code: string; label: string; source?: string } | null {
    const main = node.type === "instance" && node.componentId ? doc.nodes[node.componentId] : node.type === "component" ? node : undefined;
    const set = main?.parentId && doc.nodes[main.parentId]?.type === "componentSet" ? doc.nodes[main.parentId] : undefined;
    const list = main?.codeConnect?.length ? main.codeConnect : (set?.codeConnect ?? []);
    if (!list.length) return null;
    const platform = langInfo(lang).platform;
    const pick = list.find((c) => c.lang === lang) ?? list.find((c) => langInfo(c.lang).platform === platform);
    if (!pick) return null;
    // Fill {prop} placeholders from the instance's property values.
    let code = pick.code;
    const props = main?.componentProps ?? set?.componentProps ?? [];
    for (const p of props) {
        const value = node.type === "instance" ? (node.propValues?.[p.id] ?? p.defaultValue) : p.defaultValue;
        const shown = p.kind === "swap" ? (doc.nodes[String(value)]?.name ?? String(value)) : String(value);
        code = code.split(`{${p.name}}`).join(shown);
    }
    return { code, label: pick.name || (set ?? main)?.name || "Component", source: pick.source };
}

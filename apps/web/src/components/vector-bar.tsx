import { BezierCurve01, ChevronDown, Cursor01, Dotpoints02, Drop, Eraser, IntersectSquare, Scissors01, X } from "@untitledui/icons";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import type { VectorTool } from "../canvas/vector-edit";
import { leaveVectorEdit } from "../engine/actions";
import { openPathDialog } from "../engine/path-ops";
import { editor, useEditor } from "../engine/store";
import { joinSelectedVertices, selectAllVertices, selectedVertexRadius, setVectorTool, setVertexRadius } from "../engine/vector-actions";
import { useRef, useState } from "react";
import { MenuRow } from "./left-sidebar";
import { ColorSwatch } from "./color-picker";
import { useVectorUi, vectorUi } from "../engine/vector-ui";

// The bar that floats above the toolbar while a vector's points are being edited.
// Like the reference's bar: Move and Lasso; Paint, Bend, Shape builder and Variable width; Cut and Erase.
const TOOLS: { id: VectorTool; label: string; key: string; icon: typeof Cursor01; group: number }[] = [
    { id: "move", label: "Move", key: "V", icon: Cursor01, group: 0 },
    { id: "lasso", label: "Lasso", key: "Q", icon: Dotpoints02, group: 0 },
    { id: "paint", label: "Paint", key: "⇧B", icon: Drop, group: 1 },
    { id: "bend", label: "Bend", key: "B", icon: BezierCurve01, group: 1 },
    { id: "builder", label: "Shape builder", key: "M", icon: IntersectSquare, group: 1 },
    { id: "width", label: "Variable width", key: "⇧W", icon: WidthIcon, group: 1 },
    { id: "cut", label: "Cut", key: "X", icon: Scissors01, group: 2 },
    { id: "erase", label: "Erase", key: "⇧E", icon: Eraser, group: 2 },
];

// A stroke that swells in the middle, for the Variable width tool.
function WidthIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
            <path d="M3 15.5C7 15 9 8.5 12 8.5s5 6.5 9 7c-4 .9-6.2 2-9 2s-5-1.1-9-2Z" />
        </svg>
    );
}

export function VectorBar() {
    const editing = useEditor((s) => s.editingVectorId);
    const tool = useEditor((s) => s.vectorTool);
    const pen = useEditor((s) => s.tool === "pen");
    if (!editing) return null;
    return (
        <div className="pointer-events-auto flex h-10 items-center gap-0.5 rounded-xl bg-tooltip px-1.5 text-[11.5px] text-white shadow-xl">
            {TOOLS.map((t, i) => (
                <div key={t.id} className="flex items-center">
                    {i > 0 && TOOLS[i - 1]?.group !== t.group && <span className="mx-1 h-5 w-px bg-white/15" />}
                    <button
                        type="button"
                        title={`${t.label} (${t.key})`}
                        aria-label={t.label}
                        aria-pressed={tool === t.id && !pen}
                        onClick={() => {
                            if (pen) editor.set({ tool: "move" });
                            setVectorTool(t.id);
                        }}
                        className={`flex size-7 items-center justify-center rounded-md ${tool === t.id && !pen ? "bg-brand-500 text-white" : "text-white/85 hover:bg-white/10"}`}
                    >
                        <t.icon className="size-4" />
                    </button>
                </div>
            ))}
            {tool === "paint" && !pen && <PaintColor />}
            {tool === "erase" && !pen && <EraserSize />}
            <PointRadius />
            <span className="mx-1 h-5 w-px bg-white/15" />
            <AriaMenuTrigger>
                <AriaButton className="flex h-7 items-center gap-1 rounded-md px-2 text-white/85 outline-none hover:bg-white/10">
                    More <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="top end" offset={6} className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        className="outline-none"
                        onAction={(key) => {
                            const k = String(key);
                            if (k === "pen") editor.set({ tool: "pen" });
                            else if (k === "join") joinSelectedVertices(false);
                            else if (k === "smooth") joinSelectedVertices(true);
                            else if (k === "all") selectAllVertices();
                            else if (k === "offset") openPathDialog("offset");
                            else if (k === "simplify") openPathDialog("simplify");
                        }}
                    >
                        <MenuRow id="pen" label="Pen (continue or add a path)" shortcut="P" />
                        <MenuRow id="all" label="Select all points" shortcut="⌘ A" />
                        <MenuRow id="join" label="Join selection" shortcut="⌘ J" />
                        <MenuRow id="smooth" label="Smooth join selection" shortcut="⇧ ⌘ J" />
                        <MenuRow id="offset" label="Offset path…" />
                        <MenuRow id="simplify" label="Simplify path…" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <span className="mx-1 h-5 w-px bg-white/15" />
            <button type="button" aria-label="Done editing" title="Done (Esc)" onClick={leaveVectorEdit} className="flex size-7 items-center justify-center rounded-md text-white/85 hover:bg-white/10">
                <X className="size-3.5" />
            </button>
        </div>
    );
}

// The selected points' corner radius, shown once points are selected (the reference's point radius field).
function PointRadius() {
    const radius = useEditor((s) => (s.editingVectorId ? selectedVertexRadius(s.doc.nodes[s.editingVectorId] ?? null, s.vertices) : null));
    const any = useEditor((s) => s.vertices.some((v) => v.part === "anchor"));
    const shown = radius === null ? "Mixed" : String(radius);
    // The text being typed; null shows the selection's value.
    const [draft, setDraft] = useState<string | null>(null);
    const cancelled = useRef(false);
    if (!any) return null;
    const commit = () => {
        const value = Number(draft);
        if (!cancelled.current && draft !== null && draft.trim() !== "" && Number.isFinite(value) && String(value) !== shown) setVertexRadius(value);
        cancelled.current = false;
        setDraft(null);
    };
    return (
        <>
            <span className="mx-1 h-5 w-px bg-white/15" />
            <label className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-white/85 hover:bg-white/10" title="Corner radius of the selected points">
                <CornerIcon className="size-3.5 shrink-0" />
                <input
                    aria-label="Point corner radius"
                    value={draft ?? shown}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => {
                        setDraft(shown);
                        e.currentTarget.select();
                    }}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                            cancelled.current = true;
                            e.currentTarget.blur();
                        }
                        e.stopPropagation();
                    }}
                    className="w-9 bg-transparent text-[11.5px] text-white outline-none"
                />
            </label>
        </>
    );
}

function CornerIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
            <path d="M3 13V8a5 5 0 0 1 5-5h5" strokeLinecap="round" />
        </svg>
    );
}

// The Paint tool's fill: solid in the draw colour (shared with Draw mode's strokes), or a linear or
// radial gradient from it to a second colour.
function PaintColor() {
    const color = useEditor((s) => s.prefs.drawColor);
    const kind = useVectorUi((s) => s.paintKind);
    const color2 = useVectorUi((s) => s.paintColor2);
    const kinds = { solid: "Solid", linear: "Linear", radial: "Radial" } as const;
    return (
        <span className="ml-1 flex items-center gap-1" title="Paint fill (⌥ to remove a fill)">
            <AriaMenuTrigger>
                <AriaButton aria-label="Paint fill type" className="flex h-7 items-center gap-1 rounded-md px-1.5 text-white/85 outline-none hover:bg-white/10">
                    {kinds[kind]} <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="top start" offset={6} className="w-36 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu className="outline-none" onAction={(k) => vectorUi.set({ paintKind: k as keyof typeof kinds })}>
                        {(Object.keys(kinds) as (keyof typeof kinds)[]).map((k) => (
                            <MenuRow key={k} id={k} label={kinds[k]} checked={kind === k} />
                        ))}
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <ColorSwatch size={6} color={color} label={kind === "solid" ? "Paint colour" : "Gradient start colour"} placement="top" onChange={(drawColor) => editor.setPrefs({ drawColor })} />
            {kind !== "solid" && <ColorSwatch size={6} color={color2} label="Gradient end colour" placement="top" onChange={(paintColor2) => vectorUi.set({ paintColor2 })} />}
        </span>
    );
}

// The Erase tool's brush (round or square) and weight.
function EraserSize() {
    const size = useVectorUi((s) => s.eraserSize);
    const shape = useVectorUi((s) => s.eraserShape);
    return (
        <>
        <span className="ml-1 flex items-center rounded-md bg-white/10 p-0.5" role="radiogroup" aria-label="Eraser brush">
            {(["round", "square"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={shape === v} aria-label={v === "round" ? "Round brush" : "Square brush"} title={v === "round" ? "Round brush" : "Square brush"} onClick={() => vectorUi.set({ eraserShape: v })} className={`flex size-6 items-center justify-center rounded ${shape === v ? "bg-white/20 text-white" : "text-white/70 hover:text-white"}`}>
                    <span className={`block size-2.5 border-[1.5px] border-current ${v === "round" ? "rounded-full" : "rounded-[1px]"}`} />
                </button>
            ))}
        </span>
        <label className="ml-1 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-white/85 hover:bg-white/10" title="Eraser weight">
            <span className="text-white/60">Weight</span>
            <input
                type="number"
                min={1}
                max={400}
                value={size}
                aria-label="Eraser weight"
                onChange={(e) => vectorUi.set({ eraserSize: Math.max(1, Math.min(400, Number(e.target.value) || 1)) })}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-6 w-12 rounded bg-white/10 px-1 text-white outline-none"
            />
        </label>
        </>
    );
}

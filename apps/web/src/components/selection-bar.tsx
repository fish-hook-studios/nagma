import { ChevronDown } from "@untitledui/icons";
import type { FC, SVGProps } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { booleanSelection, createComponent, enterVectorEdit, flattenSelection, toggleMask } from "../engine/actions";
import { useEditor } from "../engine/store";
import type { BooleanOp, SceneNode } from "../engine/types";
import { setVectorTool } from "../engine/vector-actions";
import { BooleanIcon, ExcludeIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./boolean-icons";
import { ComponentIcon } from "./component-icons";
import { editWidthProfile } from "./draw-stroke-actions";
import { MenuRow } from "./left-sidebar";

// Draw mode's contextual bar over the toolbar for selected shapes and vectors, like the reference's:
// create component, edit object, use as mask and the boolean menu; then the Bend and Variable
// width tools, which open the layer for point editing with that tool picked.

type Icon = FC<SVGProps<SVGSVGElement>>;

function EditObjectIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" {...props}>
            <rect x="3.5" y="3.5" width="9" height="9" />
            {[
                [3.5, 3.5],
                [12.5, 3.5],
                [3.5, 12.5],
                [12.5, 12.5],
            ].map(([x, y]) => (
                <rect key={`${x}-${y}`} x={(x ?? 0) - 1.6} y={(y ?? 0) - 1.6} width="3.2" height="3.2" fill="currentColor" stroke="none" />
            ))}
        </svg>
    );
}

function MaskIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" {...props}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none" />
        </svg>
    );
}

function BendIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true" {...props}>
            <path d="M2.5 13C4 6.5 7 3 13.5 2.5" />
            <path d="M8.2 13.6 10.4 9l3.1 3.1-4.6 2.2z" fill="currentColor" stroke="none" />
            <path d="M10.4 9 9 7.6" />
        </svg>
    );
}

function VariableWidthIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M8 2v12" />
            <circle cx="8" cy="3" r="1.3" fill="currentColor" stroke="none" />
            <circle cx="8" cy="13" r="1.3" fill="currentColor" stroke="none" />
            <path d="M5.5 6.5 3 8l2.5 1.5M10.5 6.5 13 8l-2.5 1.5" />
        </svg>
    );
}

function BarButton({ icon: Glyph, label, shortcut, active, onPress }: { icon: Icon; label: string; shortcut?: string; active?: boolean; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={400} closeDelay={0}>
            <AriaButton aria-label={label} onPress={onPress} className={`flex size-8 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "bg-brand-500 text-white" : "text-white/85 hover:bg-white/10"}`}>
                <Glyph className="size-4" />
            </AriaButton>
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

const OPS: { op: BooleanOp; label: string; shortcut: string; icon: Icon }[] = [
    { op: "union", label: "Union selection", shortcut: "⌥ ⇧ U", icon: UnionIcon },
    { op: "subtract", label: "Subtract selection", shortcut: "⌥ ⇧ S", icon: SubtractIcon },
    { op: "intersect", label: "Intersect selection", shortcut: "⌥ ⇧ I", icon: IntersectIcon },
    { op: "exclude", label: "Exclude selection", shortcut: "⌥ ⇧ E", icon: ExcludeIcon },
];

function BooleanButton({ current }: { current: BooleanOp | null }) {
    const Glyph = OPS.find((o) => o.op === current)?.icon ?? BooleanIcon;
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Boolean operations" className="flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-white/85 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500">
                <Glyph className="size-4" />
                <ChevronDown className="size-3 mr-0.5" />
            </AriaButton>
            <AriaPopover placement="top" offset={8} className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu aria-label="Boolean operations" className="outline-none" onAction={(k) => (k === "flatten" ? flattenSelection() : booleanSelection(String(k) as BooleanOp))}>
                    {OPS.map((o) => (
                        <MenuRow key={o.op} id={o.op} label={o.label} shortcut={o.shortcut} icon={o.icon} checked={current === o.op} />
                    ))}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="flatten" label="Flatten" shortcut="⌘ E" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

const SHAPES = new Set<SceneNode["type"]>(["vector", "rect", "ellipse", "boolean", "group"]);

export function SelectionBar() {
    const mode = useEditor((s) => s.mode);
    const editing = useEditor((s) => s.editingVectorId);
    const selection = useEditor((s) => s.selection);
    const doc = useEditor((s) => s.doc);
    if (mode !== "draw" || editing || !selection.length) return null;
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length || nodes.some((n) => !SHAPES.has(n.type) || n.sourceId)) return null;
    const single = nodes.length === 1 ? nodes[0] : undefined;
    const pointable = single && (single.type === "vector" || single.type === "rect" || single.type === "ellipse") ? single : undefined;
    const edit = (tool: "move" | "bend") => {
        if (!pointable) return;
        enterVectorEdit(pointable.id);
        if (tool !== "move") setVectorTool(tool);
    };
    return (
        <div className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-xl bg-tooltip px-1.5 text-white shadow-xl" role="toolbar" aria-label="Selection actions">
            <BarButton icon={ComponentIcon} label="Create component" shortcut="⌥ ⌘ K" onPress={createComponent} />
            {pointable && <BarButton icon={EditObjectIcon} label="Edit object" shortcut="↵" onPress={() => edit("move")} />}
            <BarButton icon={MaskIcon} label={single?.isMask ? "Remove mask" : "Use as mask"} shortcut="⌃ ⌘ M" active={Boolean(single?.isMask)} onPress={toggleMask} />
            <BooleanButton current={single?.type === "boolean" ? (single.booleanOp ?? "union") : null} />
            {pointable && (
                <>
                    <span className="mx-1 h-5 w-px bg-white/15" />
                    <BarButton icon={BendIcon} label="Bend" shortcut="B" onPress={() => edit("bend")} />
                    {pointable.type === "vector" && !pointable.dynamicStroke && <BarButton icon={VariableWidthIcon} label="Variable width" shortcut="⇧ W" onPress={() => editWidthProfile([pointable])} />}
                </>
            )}
        </div>
    );
}

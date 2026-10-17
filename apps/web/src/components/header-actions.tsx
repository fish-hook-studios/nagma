import { ChevronDown, DotsHorizontal } from "@untitledui/icons";
import type { FC, SVGProps } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { booleanSelection, createComponent, enterVectorEdit, flattenSelection, toggleMask } from "../engine/actions";
import { selectMatching } from "../engine/arrange";
import { startCrop } from "../engine/image-crop";
import { isImageLayer, openPhotoEditor } from "../engine/photo";
import { replaceImage } from "../engine/image-actions";
import { isFrameLike } from "../engine/components";
import type { BooleanOp, SceneNode } from "../engine/types";
import { BooleanIcon, ExcludeIcon, IntersectIcon, SubtractIcon, UnionIcon } from "./boolean-icons";
import { ComponentIcon } from "./component-icons";
import { MenuRow } from "./left-sidebar";

// The quick actions at the right of the Design panel's header, like the reference's for shapes and
// vectors: create component, use as mask, the boolean menu and edit points.

function HeaderButton({ icon: Icon, label, shortcut, active, onPress }: { icon: FC<SVGProps<SVGSVGElement>>; label: string; shortcut?: string; active?: boolean; onPress: () => void }) {
    return (
        <AriaTooltipTrigger delay={500} closeDelay={0}>
            <AriaButton aria-label={label} onPress={onPress} className={`flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "bg-brand-100 text-brand-500" : "text-ink-muted hover:bg-panel-hover hover:text-ink"}`}>
                <Icon className="size-3.5" />
            </AriaButton>
            <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                {label}
                {shortcut && <span className="ml-2 text-white/50">{shortcut}</span>}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
}

function MaskIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
            <circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none" />
        </svg>
    );
}

// The reference's image header uses a half-filled circle for Use as mask.
function HalfMaskIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" {...props}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none" />
        </svg>
    );
}

// Select matching layers: a grid of dots, the reference's mark for it.
function MatchingIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
            {[3, 6.33, 9.67, 13].flatMap((y) => [3, 6.33, 9.67, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" />))}
        </svg>
    );
}

// The image header's overflow menu: what the old Image section held (crop, Photo), replacing the
// picture, and the shape actions an image rectangle still has.
function ImageMoreMenu({ node }: { node: SceneNode }) {
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="More image actions" className="flex size-6 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-panel-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500">
                <DotsHorizontal className="size-3.5" />
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    aria-label="More image actions"
                    className="outline-none"
                    onAction={(k) => {
                        if (k === "crop") startCrop(node.id);
                        else if (k === "photo") openPhotoEditor(node.id);
                        else if (k === "replace") replaceImage(node.id);
                        else if (k === "edit") enterVectorEdit(node.id);
                        else if (k === "flatten") flattenSelection();
                        else booleanSelection(String(k) as BooleanOp);
                    }}
                >
                    <MenuRow id="crop" label="Crop image" />
                    <MenuRow id="photo" label="Edit in Photo…" />
                    <MenuRow id="replace" label="Replace image…" />
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    {node.type === "rect" && <MenuRow id="edit" label="Edit object" shortcut="↵" />}
                    {OPS.map((o) => (
                        <MenuRow key={o.op} id={o.op} label={o.label} shortcut={o.shortcut} />
                    ))}
                    <MenuRow id="flatten" label="Flatten" shortcut="⌘ E" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function EditPointsIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" {...props}>
            <path d="M3 12.5 7 4l6 3.5" />
            <rect x="1.8" y="11.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
            <rect x="5.8" y="2.8" width="2.4" height="2.4" fill="currentColor" stroke="none" />
            <rect x="11.8" y="6.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
        </svg>
    );
}

const OPS: { op: BooleanOp; label: string; shortcut: string; icon: FC<SVGProps<SVGSVGElement>> }[] = [
    { op: "union", label: "Union selection", shortcut: "⌥ ⇧ U", icon: UnionIcon },
    { op: "subtract", label: "Subtract selection", shortcut: "⌥ ⇧ S", icon: SubtractIcon },
    { op: "intersect", label: "Intersect selection", shortcut: "⌥ ⇧ I", icon: IntersectIcon },
    { op: "exclude", label: "Exclude selection", shortcut: "⌥ ⇧ E", icon: ExcludeIcon },
];

function BooleanMenu({ current }: { current: BooleanOp | null }) {
    const Icon = OPS.find((o) => o.op === current)?.icon ?? BooleanIcon;
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Boolean operations" className={`flex h-6 items-center gap-0.5 rounded-md px-1 outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 ${current ? "text-brand-500" : "text-ink-muted hover:text-ink"}`}>
                <Icon className="size-3.5" />
                <ChevronDown className="size-3 mr-1" />
            </AriaButton>
            <AriaPopover placement="bottom end" className="w-56 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                <AriaMenu
                    className="outline-none"
                    onAction={(k) => {
                        if (k === "flatten") flattenSelection();
                        else booleanSelection(String(k) as BooleanOp);
                    }}
                >
                    {OPS.map((o) => (
                        <MenuRow key={o.op} id={o.op} label={o.label} shortcut={o.shortcut} checked={current === o.op} />
                    ))}
                    <AriaSeparator className="my-1 h-px bg-white/10" />
                    <MenuRow id="flatten" label="Flatten" shortcut="⌘ E" />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

export function HeaderActions({ nodes }: { nodes: SceneNode[] }) {
    const first = nodes[0];
    if (!first || nodes.some((n) => n.sourceId)) return null;
    const single = nodes.length === 1 ? first : undefined;
    // An image: select matching, create component, use as mask and the overflow menu.
    if (single && isImageLayer(single)) {
        return (
            <div className="flex items-center gap-0.5">
                <HeaderButton icon={MatchingIcon} label="Select matching layers" shortcut="⌥ ⌘ A" onPress={selectMatching} />
                <HeaderButton icon={ComponentIcon} label="Create component" shortcut="⌥ ⌘ K" onPress={createComponent} />
                <HeaderButton icon={HalfMaskIcon} label="Use as mask" shortcut="⌃ ⌘ M" onPress={toggleMask} />
                <ImageMoreMenu node={single} />
            </div>
        );
    }
    const frames = nodes.every((n) => isFrameLike(n) || n.type === "componentSet");
    // Components and instances already are components; component sets and sections have their own headers.
    if (nodes.some((n) => n.type === "component" || n.type === "componentSet" || n.type === "instance" || n.isSection)) return null;
    const shape = (n: SceneNode) => n.type === "rect" || n.type === "ellipse" || n.type === "vector" || n.type === "boolean" || n.type === "text" || n.type === "group";
    const editable = single && (single.type === "vector" || single.type === "rect" || single.type === "ellipse");
    return (
        <div className="flex items-center gap-0.5">
            <HeaderButton icon={ComponentIcon} label="Create component" shortcut="⌥ ⌘ K" onPress={createComponent} />
            {!frames && <HeaderButton icon={MaskIcon} label={single?.isMask ? "Remove mask" : "Use as mask"} shortcut="⌃ ⌘ M" active={Boolean(single?.isMask)} onPress={toggleMask} />}
            {nodes.every(shape) && <BooleanMenu current={first.type === "boolean" && single ? (first.booleanOp ?? "union") : null} />}
            {editable && <HeaderButton icon={EditPointsIcon} label="Edit object" shortcut="↵" onPress={() => enterVectorEdit(single.id)} />}
        </div>
    );
}

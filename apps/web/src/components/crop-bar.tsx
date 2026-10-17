import { Check, ChevronDown } from "@untitledui/icons";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { cancelCrop, cropAspect, endCrop, fitCrop, flipCrop, resetCrop, rotateCrop90 } from "../engine/image-crop";
import { useVectorUi } from "../engine/vector-ui";
import { MenuRow } from "./left-sidebar";

// Crop mode's frame proportions.
const RATIOS: { id: string; label: string; ratio: number | "original" }[] = [
    { id: "original", label: "Original", ratio: "original" },
    { id: "1:1", label: "Square 1:1", ratio: 1 },
    { id: "4:3", label: "4:3", ratio: 4 / 3 },
    { id: "3:4", label: "3:4", ratio: 3 / 4 },
    { id: "16:9", label: "16:9", ratio: 16 / 9 },
    { id: "9:16", label: "9:16", ratio: 9 / 16 },
    { id: "3:2", label: "3:2", ratio: 3 / 2 },
    { id: "2:3", label: "2:3", ratio: 2 / 3 },
];

const button = "flex h-8 items-center gap-1 rounded-lg px-1.5 text-white/85 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500";

function LayoutIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
            <path d="M2.5 6h11M6.5 6v7.5" />
        </svg>
    );
}

function CollapseIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
            <path d="M2.5 2.5 6 6M6 3v3H3M13.5 2.5 10 6M10 3v3h3M2.5 13.5 6 10M6 13v-3H3M13.5 13.5 10 10M10 13v-3h3" />
        </svg>
    );
}

// The bar over the toolbar in image crop mode, as the reference shows it: the frame's proportions
// (with rotate, flip and reset in the same menu), fit the frame to the image, then Cancel and ✓.
export function CropBar() {
    const cropping = useVectorUi((s) => s.crop !== null);
    if (!cropping) return null;
    return (
        <div data-crop-ui className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-xl bg-tooltip px-1.5 text-[12px] text-white shadow-xl" role="toolbar" aria-label="Crop">
            <AriaMenuTrigger>
                <AriaButton aria-label="Crop proportions" className={button}>
                    <LayoutIcon className="size-4" />
                    <ChevronDown className="size-3" />
                </AriaButton>
                <AriaPopover placement="top start" offset={8} className="w-48 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none" data-crop-ui>
                    <AriaMenu
                        className="outline-none"
                        aria-label="Crop proportions"
                        onAction={(key) => {
                            const k = String(key);
                            if (k === "rotate") rotateCrop90();
                            else if (k === "flip-x") flipCrop("x");
                            else if (k === "flip-y") flipCrop("y");
                            else if (k === "reset") resetCrop();
                            else cropAspect(RATIOS.find((r) => r.id === k)?.ratio ?? "original");
                        }}
                    >
                        {RATIOS.map((r) => (
                            <MenuRow key={r.id} id={r.id} label={r.label} />
                        ))}
                        <AriaSeparator className="my-1 h-px bg-white/10" />
                        <MenuRow id="rotate" label="Rotate 90°" />
                        <MenuRow id="flip-x" label="Flip horizontal" />
                        <MenuRow id="flip-y" label="Flip vertical" />
                        <MenuRow id="reset" label="Reset crop" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
            <AriaTooltipTrigger delay={400} closeDelay={0}>
                <AriaButton aria-label="Fit frame to image" onPress={fitCrop} className={`${button} w-8 justify-center`}>
                    <CollapseIcon className="size-4" />
                </AriaButton>
                <AriaTooltip offset={8} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                    Fit frame to image
                </AriaTooltip>
            </AriaTooltipTrigger>
            <span className="mx-1 h-6 w-px bg-white/15" />
            <button type="button" onClick={cancelCrop} className="h-8 rounded-lg border border-white/15 px-2.5 font-medium text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-500">
                Cancel
            </button>
            <button type="button" aria-label="Done" title="Done" onClick={endCrop} className="ml-1 flex size-8 items-center justify-center rounded-lg bg-brand-500 text-white outline-none hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-white">
                <Check className="size-4" />
            </button>
        </div>
    );
}

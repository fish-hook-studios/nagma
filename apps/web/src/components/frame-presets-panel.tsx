import { ChevronDown, ChevronRight, Plus } from "@untitledui/icons";
import { useState } from "react";
import { Button as AriaButton, TooltipTrigger as AriaTooltipTrigger, Tooltip as AriaTooltip } from "react-aria-components";
import { worldToScreen } from "../engine/camera";
import { createPresetFrame, quickAddAnchor, quickAddFrame, quickAddTarget } from "../engine/frame-tool";
import { FRAME_PRESETS, type FramePreset } from "../engine/presets";
import { useEditor } from "../engine/store";

// The right sidebar while the Frame tool is active: device and paper sizes in collapsible groups.
// Clicking one adds a frame of that size to the page.

const OPEN_BY_DEFAULT = new Set(["Phone"]);

export function FramePresetsPanel() {
    const [open, setOpen] = useState<Set<string>>(() => new Set(OPEN_BY_DEFAULT));
    const toggle = (group: string) =>
        setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            return next;
        });
    return (
        <aside aria-label="Frame presets" className="flex w-60 shrink-0 flex-col border-l border-panel-border bg-panel text-[11px] text-ink">
            <div className="flex h-10 shrink-0 items-center border-b border-panel-border px-4 font-semibold">Frame</div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                <p className="px-4 pt-1 pb-2 text-ink-muted">Click the canvas for a frame, drag to size one, or pick a preset.</p>
                {FRAME_PRESETS.map((group) => {
                    const isOpen = open.has(group.group);
                    return (
                        <section key={group.group}>
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => toggle(group.group)}
                                className="flex h-8 w-full items-center gap-1 px-3 text-left font-semibold outline-none hover:bg-panel-hover"
                            >
                                {isOpen ? <ChevronDown className="size-3 text-ink-subtle" /> : <ChevronRight className="size-3 text-ink-subtle" />}
                                {group.group}
                            </button>
                            {isOpen && (
                                <ul className="pb-1">
                                    {group.items.map((preset) => (
                                        <PresetRow key={`${group.group}:${preset.name}`} preset={preset} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        </aside>
    );
}

function PresetRow({ preset }: { preset: FramePreset }) {
    return (
        <li>
            <button type="button" onClick={() => createPresetFrame(preset)} className="flex h-7 w-full items-center justify-between gap-2 px-4 pl-7 text-left outline-none hover:bg-panel-hover">
                <span className="truncate">{preset.name}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                    {preset.w} × {preset.h}
                </span>
            </button>
        </li>
    );
}

// The "+" on either side of a top-level frame while the Frame tool is active: a copy of the frame
// next to it (⌥ for a blank frame of the same size).
export function FrameQuickAdd() {
    const target = useEditor((s) => quickAddTarget(s));
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    if (!target) return null;
    const anchor = quickAddAnchor(doc, target);
    if (!anchor) return null;
    const mid = worldToScreen(camera, anchor.x, anchor.y + anchor.h / 2);
    const right = worldToScreen(camera, anchor.x, anchor.y).x + 8;
    const left = worldToScreen(camera, anchor.left, anchor.y).x - 32;
    return (
        <>
            {(["left", "right"] as const).map((side) => (
                <AriaTooltipTrigger key={side} delay={400} closeDelay={0}>
                    <AriaButton
                        aria-label={`Add a frame ${side === "left" ? "before" : "after"} ${target.name}`}
                        onPress={(e) => quickAddFrame(target.id, !e.altKey, side)}
                        className="pointer-events-auto absolute flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-brand-500 text-white shadow-md outline-none hover:bg-brand-600"
                        style={{ left: side === "left" ? left : right, top: mid.y }}
                    >
                        <Plus className="size-3.5" />
                    </AriaButton>
                    <AriaTooltip placement={side} offset={6} className="rounded-md bg-tooltip px-2 py-1 text-[11px] text-white shadow-lg">
                        Duplicate frame (⌥ for a blank one)
                    </AriaTooltip>
                </AriaTooltipTrigger>
            ))}
        </>
    );
}

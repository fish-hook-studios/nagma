import { ChevronDown, X } from "@untitledui/icons";
import { Fragment } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Separator as AriaSeparator } from "react-aria-components";
import { type Brush, brushById, menuBrushes, brushPreviewLine, brushPreviewPath } from "../engine/brushes";
import { deleteCustomBrush } from "../engine/custom-brushes";
import { editor, useEditor } from "../engine/store";
import { strokePreviewPath } from "../engine/stroke-styles";
import { useVectorUi, vectorUi } from "../engine/vector-ui";

// The brush picker in Draw mode's strip: each brush drawn as a short stroke of its own shape.
function BrushPreview({ brush, color }: { brush: Brush; color?: string }) {
    const paint = color ?? "currentColor";
    if (brush.stroke) {
        return (
            <svg viewBox="0 0 120 20" className="h-5 w-28" aria-hidden="true">
                <path d={strokePreviewPath({ brushStroke: brush.stroke }, 120, 20, 7)} fill={paint} />
            </svg>
        );
    }
    if (brush.widthPoints) {
        return (
            <svg viewBox="0 0 120 20" className="h-5 w-28" aria-hidden="true">
                <path d={brushPreviewPath(brush)} fill={paint} fillOpacity={brush.opacity} />
            </svg>
        );
    }
    const weight = brush.id === "marker" ? 8 : 5;
    return (
        <svg viewBox="0 0 120 20" className="h-5 w-28" fill="none" aria-hidden="true">
            <path
                d={brushPreviewLine(120, 20, weight)}
                stroke={paint}
                strokeOpacity={brush.opacity}
                strokeWidth={weight}
                strokeLinecap={brush.cap}
                strokeLinejoin="round"
                strokeDasharray={brush.dash ? `${brush.dash[0] * weight} ${brush.dash[1] * weight}` : undefined}
            />
        </svg>
    );
}

// Deleting the current brush falls back to the first built-in one.
function removeBrush(menuId: string) {
    const id = menuId.replace(/^custom-/, "");
    deleteCustomBrush(id);
    if (vectorUi.get().brush === menuId) vectorUi.set({ brush: brushById("", null).id });
    editor.notify("Brush deleted.");
}

export function BrushMenu({ color }: { color: string }) {
    const doc = useEditor((s) => s.doc);
    const list = menuBrushes(doc);
    const current = brushById(useVectorUi((s) => s.brush), doc);
    return (
        <AriaMenuTrigger>
            <AriaButton aria-label="Brush" className="flex h-8 items-center gap-2 rounded-lg bg-field px-2 text-ink outline-none hover:bg-panel-hover">
                <BrushPreview brush={current} color={color} />
                <ChevronDown className="size-3 text-ink-muted" />
            </AriaButton>
            <AriaPopover placement="top" offset={8} className="max-h-[70vh] overflow-y-auto rounded-xl bg-tooltip p-1.5 text-white shadow-xl outline-none">
                <AriaMenu className="outline-none" aria-label="Brushes" onAction={(k) => vectorUi.set({ brush: String(k) })}>
                    {list.map((b, i) => (
                        <Fragment key={b.id}>
                        {i > 0 && list[i - 1]?.group !== b.group && <AriaSeparator className="my-1 h-px bg-white/10" />}
                        <AriaMenuItem id={b.id} textValue={b.name} className="group flex h-8 cursor-default items-center gap-3 rounded px-2 text-[11px] outline-none data-[focused]:bg-brand-500">
                            <span className="w-3 text-center">{current.id === b.id ? "✓" : ""}</span>
                            <BrushPreview brush={b} />
                            <span className="min-w-16 whitespace-nowrap">{b.name}</span>
                            {b.group === "custom" && (
                                // Custom brushes can be removed from the file; strokes already drawn keep their look.
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={`Delete brush ${b.name}`}
                                    title="Delete brush"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onPointerUp={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        removeBrush(b.id);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="ml-auto flex size-5 items-center justify-center rounded text-white/50 opacity-0 group-hover:opacity-100 group-data-[focused]:opacity-100 hover:bg-white/15 hover:text-white"
                                >
                                    <X className="size-3" />
                                </span>
                            )}
                        </AriaMenuItem>
                        </Fragment>
                    ))}
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

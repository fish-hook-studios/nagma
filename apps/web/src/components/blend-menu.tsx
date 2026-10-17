import { Check, ChevronDown } from "@untitledui/icons";
import { Button as AriaButton, Menu as AriaMenu, MenuItem as AriaMenuItem, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover, Section as AriaSection, Separator as AriaSeparator } from "react-aria-components";
import { BLEND_GROUPS, blendLabel } from "../engine/paint";
import { applyCommand } from "../engine/commands";
import { editor } from "../engine/store";
import type { BlendMode, SceneNode } from "../engine/types";

// The reference's blend mode list: grouped, with a live preview on the canvas while an entry is hovered.
// `onPreview(null)` ends the preview (the menu closed without a pick).

export function BlendMenu({
    value,
    onChange,
    onPreview,
    passThrough,
    children,
    label = "Blend mode",
}: {
    value: BlendMode | null;
    onChange: (mode: BlendMode) => void;
    onPreview?: (mode: BlendMode | null) => void;
    passThrough?: boolean;
    children: React.ReactNode;
    label?: string;
}) {
    return (
        <AriaMenuTrigger onOpenChange={(open) => !open && onPreview?.(null)}>
            {children}
            <AriaPopover placement="bottom end" className="max-h-[70vh] w-44 overflow-y-auto rounded-lg bg-tooltip p-1 font-sans text-white shadow-xl outline-none">
                <AriaMenu
                    aria-label={label}
                    className="outline-none"
                    onAction={(key) => onChange(String(key) as BlendMode)}
                >
                    <PreviewItems value={value} passThrough={passThrough} onPreview={onPreview} />
                </AriaMenu>
            </AriaPopover>
        </AriaMenuTrigger>
    );
}

function PreviewItems({ value, passThrough, onPreview }: { value: BlendMode | null; passThrough?: boolean; onPreview?: (mode: BlendMode | null) => void }) {
    const groups = BLEND_GROUPS.map((g) => g.filter((m) => passThrough || m !== "pass-through")).filter((g) => g.length);
    return (
        <>
            {groups.map((group, gi) => (
                <AriaSection key={group.join()}>
                    {gi > 0 && <AriaSeparator className="my-1 h-px bg-white/10" />}
                    {group.map((mode) => (
                        <AriaMenuItem
                            key={mode}
                            id={mode}
                            textValue={blendLabel(mode)}
                            onHoverStart={() => onPreview?.(mode)}
                            onFocus={() => onPreview?.(mode)}
                            className="flex h-6 cursor-default items-center gap-2 rounded-md pr-3 pl-1.5 text-[12px] text-white outline-none data-[focused]:bg-brand-500"
                        >
                            <span className="flex w-3 shrink-0 justify-center">{value === mode && <Check className="size-3" />}</span>
                            {blendLabel(mode)}
                        </AriaMenuItem>
                    ))}
                </AriaSection>
            ))}
        </>
    );
}

// A field-like button that opens the blend menu (used in effect and paint settings).
export function BlendSelect({ value, onChange, onPreview, passThrough }: { value: BlendMode | null; onChange: (mode: BlendMode) => void; onPreview?: (mode: BlendMode | null) => void; passThrough?: boolean }) {
    return (
        <BlendMenu value={value} onChange={onChange} onPreview={onPreview} passThrough={passThrough}>
            <AriaButton aria-label="Blend mode" className="flex h-6 w-full items-center gap-2 rounded-md border border-transparent bg-field px-2 text-left text-ink outline-none hover:border-panel-border focus-visible:border-brand-500">
                <BlendIcon className="size-3.5 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate">{value ? blendLabel(value) : "Mixed"}</span>
                <ChevronDown className="size-3 text-ink-subtle" />
            </AriaButton>
        </BlendMenu>
    );
}

// A drop, half filled: the blend mark, drawn here.
export function BlendIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <path d="M8 2.2C6.4 4.3 3.8 7.1 3.8 9.6a4.2 4.2 0 0 0 8.4 0C12.2 7.1 9.6 4.3 8 2.2z" strokeLinejoin="round" />
            <path d="M8 13.8a4.2 4.2 0 0 1-4.2-4.2c0-.5.1-1 .3-1.5h7.8c.2.5.3 1 .3 1.5A4.2 4.2 0 0 1 8 13.8z" fill="currentColor" stroke="none" />
        </svg>
    );
}

// The Appearance section's blend button: an icon that opens the menu, previewing each mode on the
// canvas while hovered. Pass through heads the list (for a single shape it draws like Normal).
export function LayerBlendButton({ nodes }: { nodes: SceneNode[] }) {
    const modeOf = (n: SceneNode | undefined) => n?.blendMode ?? "normal";
    const mode = nodes.every((n) => modeOf(n) === modeOf(nodes[0])) ? modeOf(nodes[0]) : null;
    const plain = mode === "normal" || mode === "pass-through";
    const command = (blendMode: BlendMode) => ({ type: "batch" as const, commands: nodes.map((n) => ({ type: "node.update" as const, id: n.id, patch: { blendMode } })) });
    return (
        <BlendMenu
            value={mode}
            passThrough
            label="Layer blend mode"
            onChange={(blendMode) => editor.execute(command(blendMode), editor.committed())}
            onPreview={(blendMode) => editor.preview(blendMode ? applyCommand(editor.committed(), command(blendMode)) : editor.committed())}
        >
            <AriaButton aria-label={`Blend mode: ${mode ? blendLabel(mode) : "Mixed"}`} className={`flex size-6 items-center justify-center rounded-md outline-none hover:bg-panel-hover focus-visible:ring-2 focus-visible:ring-brand-500 ${plain ? "text-ink-muted hover:text-ink" : "bg-brand-100 text-brand-500"}`}>
                <BlendIcon className="size-3.5" />
            </AriaButton>
        </BlendMenu>
    );
}

import { Crop01, Edit05 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { ADJUST_KEYS, ADJUST_LABELS, NO_ADJUST, bakeAdjust, isAdjusted } from "../engine/image-adjust";
import { startCrop } from "../engine/image-crop";
import { openPhotoEditor } from "../engine/photo";
import { editor, useEditor } from "../engine/store";
import type { ImageAdjust, ImagePaint, SceneNode } from "../engine/types";

// The image sliders (Exposure, Contrast, Saturation, Temperature, Tint, Highlights, Shadows) under
// an "Adjust" heading with Reset. Changes are baked into a new image a moment after the slider
// stops (engine/image-adjust.ts); the untouched image is kept so the sliders stay editable.
export function AdjustSliders({ paint, onChange, compact }: { paint: ImagePaint; onChange: (p: ImagePaint) => void; compact?: boolean }) {
    const images = useEditor((s) => s.doc.images);
    const [adjust, setAdjust] = useState<ImageAdjust>(paint.adjust ?? NO_ADJUST);
    const [busy, setBusy] = useState(false);
    const pending = useRef<number | undefined>(undefined);
    const latest = useRef(adjust);
    const source = paint.original ?? paint.id;
    useEffect(() => {
        setAdjust(paint.adjust ?? NO_ADJUST);
        // Another image opened: show its own values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source]);

    const bake = (next: ImageAdjust) => {
        latest.current = next;
        window.clearTimeout(pending.current);
        pending.current = window.setTimeout(async () => {
            const wanted = latest.current;
            setBusy(true);
            try {
                if (!isAdjusted(wanted)) {
                    onChange({ ...paint, id: paint.original ?? paint.id, original: undefined, adjust: undefined });
                    return;
                }
                const baked = await bakeAdjust(paint, images, wanted);
                if (!baked || latest.current !== wanted) return;
                editor.execute({ type: "image.add", id: baked.id, data: baked.data });
                onChange({ ...paint, id: baked.id, original: paint.original ?? paint.id, adjust: wanted });
                editor.mergeLast();
            } catch (error) {
                editor.notify(`Couldn't adjust the image: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                setBusy(false);
            }
        }, 250);
    };
    const set = (next: ImageAdjust) => {
        setAdjust(next);
        bake(next);
    };

    // The paint popover's rows, as the reference lays them out: a name, then a centred slider
    // (double-click puts it back to 0); Reset shows once something has moved.
    if (compact)
        return (
            <div className="space-y-2.5" aria-label="Adjust">
                {ADJUST_KEYS.map((key) => (
                    <div key={key} className="grid grid-cols-[80px_1fr] items-center gap-2">
                        <span className="truncate text-ink-muted" title={ADJUST_LABELS[key]}>
                            {ADJUST_LABELS[key]}
                        </span>
                        <CentredSlider label={ADJUST_LABELS[key]} value={adjust[key]} onChange={(v) => set({ ...adjust, [key]: v })} />
                    </div>
                ))}
                {(isAdjusted(adjust) || busy) && (
                    <div className="flex h-5 items-center justify-between text-ink-subtle">
                        <span>{busy ? "Adjusting…" : ""}</span>
                        <button type="button" disabled={!isAdjusted(adjust)} onClick={() => set({ ...NO_ADJUST })} className="rounded px-1 text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40">
                            Reset
                        </button>
                    </div>
                )}
            </div>
        );
    return (
        <div className="space-y-1">
            <div className="flex h-6 items-center justify-between">
                <span className="font-medium text-ink">Adjust{busy ? <span className="ml-2 font-normal text-ink-subtle">Adjusting…</span> : null}</span>
                <button type="button" disabled={!isAdjusted(adjust)} onClick={() => set({ ...NO_ADJUST })} className="rounded px-1.5 text-ink-muted hover:bg-panel-hover hover:text-ink disabled:opacity-40">
                    Reset
                </button>
            </div>
            {ADJUST_KEYS.map((key) => (
                <label key={key} className="grid grid-cols-[72px_1fr_30px] items-center gap-2">
                    <span className="truncate text-ink-muted">{ADJUST_LABELS[key]}</span>
                    <input
                        type="range"
                        min={-100}
                        max={100}
                        value={adjust[key]}
                        aria-label={ADJUST_LABELS[key]}
                        onChange={(e) => set({ ...adjust, [key]: Number(e.target.value) })}
                        onDoubleClick={() => set({ ...adjust, [key]: 0 })}
                        className="h-1 w-full accent-brand-500"
                    />
                    <span className="text-right font-mono text-[10px] text-ink-subtle">{adjust[key]}</span>
                </label>
            ))}
        </div>
    );
}

// A -100..100 slider whose thumb rests in the middle: a pill track with a white thumb, a native
// range input on top for dragging and the keyboard.
function CentredSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    const pos = `calc(9px + (100% - 18px) * ${(value + 100) / 200})`;
    return (
        <div className="relative h-[18px]" title={String(value)}>
            <div className="absolute inset-0 rounded-full border border-panel-border bg-field" />
            {value !== 0 && <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-brand-500" style={value > 0 ? { left: "50%", width: `calc(${pos} - 50%)` } : { left: pos, width: `calc(50% - ${pos})` }} />}
            <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-black/10" style={{ left: pos }} />
            <input type="range" min={-100} max={100} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>
    );
}

// The Image section for a layer whose top fill is an image: Crop, Edit in Photo, and Adjust. Used by
// Campaign's context toolbar; the Design panel keeps adjustments in the fill's paint popover instead.
export function ImageSection({ node }: { node: SceneNode }) {
    let index = -1;
    for (let i = node.fills.length - 1; i >= 0; i--) {
        if (node.fills[i]?.type === "image" && node.fills[i]?.visible) {
            index = i;
            break;
        }
    }
    const paint = index >= 0 ? (node.fills[index] as ImagePaint) : null;
    if (!paint || paint.video || node.sourceId) return null;
    const write = (next: ImagePaint) => {
        const latest = editor.get().doc.nodes[node.id];
        if (!latest) return;
        editor.execute({ type: "node.update", id: node.id, patch: { fills: latest.fills.map((p, i) => (i === index ? next : p)) } });
    };
    return (
        <section className="border-b border-panel-border px-3 py-2.5">
            <div className="flex h-6 items-center justify-between">
                <h3 className="font-semibold">Image</h3>
            </div>
            <div className="mt-1.5 space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => startCrop(node.id, index)} className="flex h-6 items-center justify-center gap-1.5 rounded-md bg-field text-ink hover:bg-panel-hover">
                        <Crop01 className="size-3.5" /> Crop
                    </button>
                    <button type="button" onClick={() => openPhotoEditor(node.id)} className="flex h-6 items-center justify-center gap-1.5 rounded-md bg-field text-ink hover:bg-panel-hover">
                        <Edit05 className="size-3.5" /> Edit in Photo
                    </button>
                </div>
                <AdjustSliders paint={paint} onChange={write} />
            </div>
        </section>
    );
}

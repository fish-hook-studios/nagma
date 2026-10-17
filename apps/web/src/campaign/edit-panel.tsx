import { Crop01, Image01, Lock01, Move, Plus, Scissors01, Stars02, Upload01 } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { AdjustSliders } from "../components/image-section";
import { Select } from "../components/select";
import { imageSrc, preloadImages } from "../engine/image-store";
import { startCrop } from "../engine/image-crop";
import { editor, useEditor } from "../engine/store";
import type { ExportSetting, ImagePaint, SceneNode } from "../engine/types";
import { brandOf, fieldValuePatch, fieldsOf, layerData } from "./model";
import { replaceImage } from "./actions";
import { removeBackground } from "./remove-background";

// The pieces Edit mode edits fields with, shown in the floating toolbar's menus: text boxes,
// image swaps, palette swatches. Only the fields the template opens up are offered; everything else
// on the asset stays as designed.

const button = "flex h-7 items-center justify-center gap-1.5 rounded-md border border-panel-border px-2 text-[11px] text-ink outline-none hover:bg-panel-hover disabled:opacity-40";

// Typing in a field: the first keystroke is an undo step, the rest fold into it.
function useMergedEdits() {
    const typing = useRef<string | null>(null);
    return {
        edit(id: string, patch: Partial<SceneNode>) {
            editor.execute({ type: "node.update", id, patch });
            if (typing.current === id) editor.mergeLast();
            typing.current = id;
        },
        done() {
            typing.current = null;
        },
    };
}

export function Swatches({ colors, current, onPick, allowCustom, label }: { colors: { name: string; color: string }[]; current: string; onPick: (c: string) => void; allowCustom: boolean; label: string }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
            {colors.map((c) => (
                <button
                    key={`${c.name}${c.color}`}
                    type="button"
                    role="radio"
                    aria-checked={current.toUpperCase().slice(0, 7) === c.color.toUpperCase().slice(0, 7)}
                    aria-label={c.name}
                    title={`${c.name} ${c.color}`}
                    onClick={() => onPick(c.color)}
                    className={`size-6 rounded-full border border-black/10 outline-none ${current.toUpperCase().slice(0, 7) === c.color.toUpperCase().slice(0, 7) ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-panel" : ""}`}
                    style={{ background: c.color }}
                />
            ))}
            {allowCustom && (
                <label className="relative flex size-6 items-center justify-center rounded-full border border-dashed border-panel-border text-ink-muted" title="Custom colour">
                    <Plus className="size-3" />
                    <input type="color" aria-label="Custom colour" value={current.slice(0, 7) || "#000000"} onChange={(e) => onPick(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                </label>
            )}
        </div>
    );
}

function ImagePreview({ paint }: { paint: ImagePaint }) {
    const images = useEditor((s) => s.doc.images);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        void preloadImages({ [paint.id]: images[paint.id] ?? "" }).then(() => live && setUrl(imageSrc(images, paint.id)));
        return () => {
            live = false;
        };
    }, [paint.id, images]);
    return (
        <span className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-panel-border bg-[repeating-conic-gradient(#ddd_0%_25%,#fff_0%_50%)] bg-[length:12px_12px]">
            {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : null}
        </span>
    );
}

function pickImage(onFile: (file: File) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) onFile(file);
    };
    input.click();
}

export function ImageField({ node }: { node: SceneNode }) {
    const data = layerData(node);
    const index = node.fills.findIndex((p) => p.type === "image");
    const paint = index >= 0 ? (node.fills[index] as ImagePaint) : null;
    const [busy, setBusy] = useState(false);
    const [adjust, setAdjust] = useState(false);
    if (!data) return null;
    const setPaint = (next: ImagePaint) => editor.execute({ type: "node.update", id: node.id, patch: { fills: node.fills.map((p, i) => (i === index ? next : p)) } });
    return (
        <div className="space-y-2">
            {paint ? <ImagePreview paint={paint} /> : <span className="flex h-16 items-center justify-center rounded-md border border-dashed border-panel-border text-ink-subtle">No image</span>}
            <div className="grid grid-cols-2 gap-1.5">
                <button type="button" className={button} onClick={() => pickImage((f) => void replaceImage(node, f))} aria-label={`Replace ${data.field}`}>
                    <Upload01 className="size-3" /> Replace
                </button>
                <button
                    type="button"
                    className={button}
                    disabled={!paint || busy}
                    onClick={() => {
                        setBusy(true);
                        void removeBackground(node.id)
                            .then((ok) => editor.notify(ok ? "Background removed." : "Couldn't read that image."))
                            .catch((e) => editor.notify(`Couldn't remove the background: ${e instanceof Error ? e.message : String(e)}`))
                            .finally(() => setBusy(false));
                    }}
                >
                    <Scissors01 className="size-3" /> {busy ? "Working…" : "Remove background"}
                </button>
            </div>
            {paint && (
                <div className="flex items-center gap-1.5">
                    <div role="radiogroup" aria-label="Image fit" className="flex flex-1 rounded-md border border-panel-border p-0.5">
                        {(["fill", "fit"] as const).map((mode) => (
                            <button key={mode} type="button" role="radio" aria-checked={paint.mode === mode} onClick={() => setPaint({ ...paint, mode, crop: undefined })} className={`h-6 flex-1 rounded text-[11px] ${paint.mode === mode ? "bg-panel-hover font-semibold text-ink" : "text-ink-muted"}`}>
                                {mode === "fill" ? "Fill" : "Fit"}
                            </button>
                        ))}
                        <button type="button" role="radio" aria-checked={paint.mode === "crop"} onClick={() => startCrop(node.id, index)} className={`flex h-6 flex-1 items-center justify-center gap-1 rounded text-[11px] ${paint.mode === "crop" ? "bg-panel-hover font-semibold text-ink" : "text-ink-muted"}`}>
                            <Crop01 className="size-3" /> Crop
                        </button>
                    </div>
                    <button type="button" aria-expanded={adjust} onClick={() => setAdjust(!adjust)} className={`${button} ${adjust ? "bg-panel-hover" : ""}`}>
                        <Stars02 className="size-3" /> Adjust
                    </button>
                </div>
            )}
            {paint && adjust && <AdjustSliders paint={paint} onChange={(p) => setPaint(p)} />}
        </div>
    );
}

export function FieldEditor({ node, focused, edits }: { node: SceneNode; focused: boolean; edits: ReturnType<typeof useMergedEdits> }) {
    const doc = useEditor((s) => s.doc);
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (focused && ref.current && document.activeElement !== ref.current) ref.current.focus();
    }, [focused]);
    const data = layerData(node);
    if (!data) return null;
    const brand = brandOf(doc);
    const solidAt = node.fills.findIndex((p) => p.type === "solid");
    const solidPaint = solidAt >= 0 ? node.fills[solidAt] : undefined;
    const color = solidPaint?.type === "solid" ? solidPaint.color : "";
    const setColor = (c: string) => {
        const patch = fieldValuePatch(node, "color", c);
        if (patch) editor.execute({ type: "node.update", id: node.id, patch });
    };
    return (
        <div data-field={data.field} className={`rounded-md px-2 py-2 ${focused ? "bg-brand-100/40 ring-1 ring-brand-500/50" : ""}`}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink">
                {data.type === "image" ? <Image01 className="size-3 text-ink-subtle" /> : null}
                <button type="button" onClick={() => editor.set({ selection: [node.id] })} className="min-w-0 flex-1 truncate text-left">{data.field}</button>
                {!data.locks.position && <span title="Can be moved on the canvas"><Move className="size-3 text-ink-subtle" /></span>}
            </div>
            {data.type === "text" && !data.locks.content && (
                <textarea
                    ref={ref}
                    aria-label={data.field}
                    value={node.text ?? ""}
                    rows={Math.min(5, Math.max(1, Math.ceil((node.text ?? "").length / 32)))}
                    onChange={(e) => edits.edit(node.id, { text: e.target.value, spans: undefined })}
                    onBlur={edits.done}
                    className="w-full resize-y rounded-md border border-panel-border bg-canvas px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand-500"
                />
            )}
            {data.type === "image" && !data.locks.content && <ImageField node={node} />}
            {!data.locks.style && (
                <div className={data.type === "color" ? "" : "mt-2"}>
                    {data.type !== "color" && <div className="mb-1 text-[10px] text-ink-subtle">Colour</div>}
                    <Swatches label={`${data.field} colour`} colors={brand.colors} current={color} onPick={setColor} allowCustom={!data.brandOnly} />
                </div>
            )}
        </div>
    );
}

const EXPORT_FORMATS: ExportSetting["format"][] = ["png", "jpg", "pdf"];

export function AssetExportSettings({ asset }: { asset: SceneNode }) {
    const setting = asset.exportSettings?.[0];
    const set = (next: ExportSetting | null) => editor.execute({ type: "node.update", id: asset.id, patch: { exportSettings: next ? [next] : [] } });
    return (
        <div className="flex items-center gap-1.5">
            <Select aria-label="Asset export format" value={setting?.format ?? "default"} onChange={(e) => set(e.target.value === "default" ? null : { format: e.target.value as ExportSetting["format"], scale: setting?.scale ?? 1, suffix: "", contentsOnly: true })} className="h-7 flex-1 rounded-md border border-panel-border bg-panel px-2 text-[11px] text-ink">
                <option value="default">Campaign default</option>
                {EXPORT_FORMATS.map((f) => (
                    <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
            </Select>
            <Select aria-label="Asset export scale" disabled={!setting} value={String(setting?.scale ?? 1)} onChange={(e) => setting && set({ ...setting, scale: Number(e.target.value) })} className="h-7 w-16 rounded-md border border-panel-border bg-panel px-2 text-[11px] text-ink">
                {[0.5, 1, 2, 3].map((s) => (
                    <option key={s} value={String(s)}>{s}x</option>
                ))}
            </Select>
        </div>
    );
}

// Every field the asset opens up, for the floating toolbar's Fields menu in Edit mode.
export function FieldsList({ asset }: { asset: SceneNode }) {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const readOnly = useEditor((s) => s.readOnly);
    const edits = useMergedEdits();
    const fields = fieldsOf(doc, asset.id).filter((n) => {
        const d = layerData(n);
        return d && (!d.locks.content || !d.locks.style || !d.locks.position);
    });
    if (!fields.length) {
        return (
            <p className="flex gap-2 px-2 py-2 text-ink-muted">
                <Lock01 className="size-3.5 shrink-0" />
                Nothing on this asset is open for editing. A template owner can open fields up in Design mode.
            </p>
        );
    }
    if (readOnly) return <p className="px-2 py-2 text-ink-muted">You can view this campaign but not edit it.</p>;
    return (
        <div className="space-y-1">
            {fields.map((n) => (
                <FieldEditor key={n.id} node={n} focused={selection.includes(n.id)} edits={edits} />
            ))}
        </div>
    );
}

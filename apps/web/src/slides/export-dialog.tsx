import { useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { Select } from "../components/select";
import { useEditor } from "../engine/store";
import { DEFAULT_EXPORT, type SlideExport, exportSlides } from "./actions";
import { slides, useSelectedSlides, useSlides } from "./state";

// Main menu > Export slides: the file type, which slides, and the type's options.

const FORMATS: { id: SlideExport["format"]; label: string }[] = [
    { id: "pdf", label: "PDF" },
    { id: "pptx", label: "Presentation (.pptx)" },
    { id: "png", label: "PNG images" },
    { id: "jpg", label: "JPG images" },
];

const field = "h-8 w-full rounded-md border border-panel-border bg-field px-2 text-[12px] text-ink outline-none focus:border-brand-500";

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-start gap-2 py-1">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-brand-500" />
            <span>
                <span className="block">{label}</span>
                {hint && <span className="block text-ink-muted">{hint}</span>}
            </span>
        </label>
    );
}

function ExportForm({ close }: { close: () => void }) {
    const picked = useSelectedSlides();
    const fileProfile = useEditor((s) => s.doc.colorProfile ?? "srgb");
    const [options, setOptions] = useState<SlideExport>(DEFAULT_EXPORT);
    const set = (patch: Partial<SlideExport>) => setOptions((o) => ({ ...o, ...patch }));
    return (
        <form
            className="space-y-4 p-5 text-[12px]"
            onSubmit={(e) => {
                e.preventDefault();
                close();
                void exportSlides(options);
            }}
        >
            <h2 className="text-[14px] font-semibold">Export slides</h2>
            <label className="block space-y-1.5">
                <span className="text-ink-muted">File type</span>
                <Select aria-label="File type" value={options.format} onChange={(e) => set({ format: e.target.value as SlideExport["format"] })} className={field}>
                    {FORMATS.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                </Select>
            </label>
            <label className="block space-y-1.5">
                <span className="text-ink-muted">Content</span>
                <Select aria-label="Content" value={options.content} onChange={(e) => set({ content: e.target.value as SlideExport["content"] })} className={field}>
                    <option value="all">All slides</option>
                    <option value="selected">Selected slides ({picked.length})</option>
                </Select>
            </label>
            <div>
                <Check label="Include skipped slides" checked={options.skipped} onChange={(skipped) => set({ skipped })} />
                {options.format === "pdf" && <Check label="Include presenter notes" hint="Each slide gets a page with its notes under it." checked={options.notes} onChange={(notes) => set({ notes })} />}
                {options.format === "pptx" && <Check label="Flatten each slide into one picture" hint="Otherwise text, rectangles and ellipses stay editable and the rest become pictures." checked={options.flat} onChange={(flat) => set({ flat })} />}
            </div>
            {options.format === "pdf" && (
                <div className="flex gap-2">
                    <label className="block flex-1 space-y-1.5">
                        <span className="text-ink-muted">Color profile</span>
                        <Select aria-label="Color profile" value={options.profile} onChange={(e) => set({ profile: e.target.value as SlideExport["profile"] })} className={field}>
                            <option value="document">Same as file ({fileProfile === "p3" ? "Display P3" : "sRGB"})</option>
                            <option value="srgb">sRGB</option>
                            <option value="p3">Display P3</option>
                        </Select>
                    </label>
                    <label className="block flex-1 space-y-1.5">
                        <span className="text-ink-muted">Quality</span>
                        <Select aria-label="Quality" value={options.quality} onChange={(e) => set({ quality: e.target.value as SlideExport["quality"] })} className={field}>
                            <option value="low">Low (smaller file)</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </Select>
                    </label>
                </div>
            )}
            {(options.format === "png" || options.format === "jpg") && (
                <label className="block space-y-1.5">
                    <span className="text-ink-muted">Size</span>
                    <Select aria-label="Size" value={String(options.scale)} onChange={(e) => set({ scale: Number(e.target.value) })} className={field}>
                        <option value="1">1x (1920 × 1080)</option>
                        <option value="2">2x (3840 × 2160)</option>
                    </Select>
                </label>
            )}
            <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={close} className="h-8 rounded-md px-3 text-ink hover:bg-panel-hover">Cancel</button>
                <button type="submit" className="h-8 rounded-md bg-[#F24E1E] px-3 font-semibold text-white hover:bg-[#DA4419]">Export</button>
            </div>
        </form>
    );
}

export function ExportSlidesDialog() {
    const open = useSlides((s) => s.exportOpen);
    const close = () => slides.set({ exportOpen: false });
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-28">
            <AriaModal className="w-[380px] rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none">
                <AriaDialog aria-label="Export slides" className="outline-none">{open && <ExportForm close={close} />}</AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

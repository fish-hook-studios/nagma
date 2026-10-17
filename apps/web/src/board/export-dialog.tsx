import { X } from "@untitledui/icons";
import { useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { editor, useEditor } from "../engine/store";
import { type BoardExportBackground, type BoardExportFormat, exportBoard } from "./export";
import { board, useBoard } from "./state";

// File > Export on a board: what to export (the board or the selection), the format, and the size.

const FORMATS: { format: BoardExportFormat; label: string }[] = [
    { format: "png", label: "PNG" },
    { format: "jpg", label: "JPG" },
    { format: "pdf", label: "PDF" },
    { format: "csv", label: "CSV" },
];

export function BoardExportDialog() {
    const open = useBoard((s) => s.exportOpen);
    const hasSelection = useEditor((s) => s.selection.length > 0);
    const [format, setFormat] = useState<BoardExportFormat>("png");
    const [scope, setScope] = useState<"board" | "selection">("board");
    const [scale, setScale] = useState(2);
    const [background, setBackground] = useState<BoardExportBackground>("solid");
    const [busy, setBusy] = useState(false);
    const close = () => board.set({ exportOpen: false });
    const which = hasSelection ? scope : "board";
    const run = async () => {
        setBusy(true);
        try {
            if (await exportBoard(format, which === "selection", scale, format === "jpg" && background === "transparent" ? "solid" : background)) close();
        } catch (error) {
            console.error(error);
            editor.notify("Export failed. Try a smaller size.");
        } finally {
            setBusy(false);
        }
    };
    const chip = (on: boolean) => `h-8 flex-1 rounded-lg text-[12px] font-medium ${on ? "bg-[#9747FF] text-white" : "bg-black/5 hover:bg-black/10"}`;
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => board.set({ exportOpen: o })} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24">
            <AriaModal className="w-[360px] rounded-2xl bg-white p-5 text-[#1E1E1E] shadow-2xl outline-none">
                <AriaDialog aria-label="Export" className="space-y-4 outline-none">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[15px] font-semibold">Export</h2>
                        <button type="button" aria-label="Close" onClick={close} className="rounded p-1 hover:bg-black/5"><X className="size-4" /></button>
                    </div>
                    <div className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-black/60">Export</span>
                        <div className="flex gap-1.5">
                            <button type="button" aria-pressed={which === "board"} onClick={() => setScope("board")} className={chip(which === "board")}>Whole board</button>
                            <button type="button" aria-pressed={which === "selection"} disabled={!hasSelection} onClick={() => setScope("selection")} className={`${chip(which === "selection")} disabled:opacity-40`}>Selection</button>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-black/60">Format</span>
                        <div className="flex gap-1.5">
                            {FORMATS.map((f) => (
                                <button key={f.format} type="button" aria-pressed={format === f.format} onClick={() => setFormat(f.format)} className={chip(format === f.format)}>{f.label}</button>
                            ))}
                        </div>
                        {format === "csv" && <p className="text-[11.5px] text-black/60">A selected table exports its cells; otherwise every sticky note (its text, author, colour and section) becomes a row.</p>}
                    </div>
                    {format !== "csv" && (
                        <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold text-black/60">Background</span>
                            <div className="flex gap-1.5">
                                {(["solid", "transparent", "grid"] as const).map((b) => (
                                    <button key={b} type="button" aria-pressed={background === b} disabled={b === "transparent" && format === "jpg"} onClick={() => setBackground(b)} className={`${chip(background === b && !(b === "transparent" && format === "jpg"))} disabled:opacity-40`}>{b === "solid" ? "Solid" : b === "transparent" ? "Transparent" : "Grid"}</button>
                                ))}
                            </div>
                        </div>
                    )}
                    {format !== "csv" && (
                        <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold text-black/60">Size</span>
                            <div className="flex gap-1.5">
                                {[1, 2, 3].map((s) => (
                                    <button key={s} type="button" aria-pressed={scale === s} onClick={() => setScale(s)} className={chip(scale === s)}>{s}x</button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={close} className="h-8 rounded-lg px-3 text-[12px] hover:bg-black/5">Cancel</button>
                        <button type="button" disabled={busy} onClick={() => void run()} className="h-8 rounded-lg bg-[#9747FF] px-4 text-[12px] font-semibold text-white hover:bg-[#8638E5] disabled:opacity-50">{busy ? "Exporting…" : "Export"}</button>
                    </div>
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

import { X } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Dialog as AriaDialog, Modal as AriaModal, ModalOverlay as AriaModalOverlay } from "react-aria-components";
import { Select } from "../components/select";
import { download } from "../engine/export";
import { editor } from "../engine/store";
import { DOC_BLUE } from "./model";
import { chooseSignature, forgetSignature, rememberedSignature } from "./signature";
import { docView, edit, fileBase, saveNow, unlock, useDoc, workbench } from "./state";

// The Document workbench's dialogs: signatures, password protection, splitting, and the password
// a protected PDF asks for.

const field = "w-full rounded-md border border-panel-border bg-field px-3 text-[12px] text-ink outline-none focus:border-brand-500";
const primary = "h-8 rounded-md px-4 text-[12px] font-semibold text-white disabled:opacity-40";

export function Modal({ title, open, onClose, width = 440, children, footer }: { title: string; open: boolean; onClose: () => void; width?: number; children: React.ReactNode; footer?: React.ReactNode }) {
    return (
        <AriaModalOverlay isOpen={open} onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
            <AriaModal className="rounded-xl border border-panel-border bg-panel-raised text-ink shadow-2xl outline-none" style={{ width }}>
                <AriaDialog aria-label={title} className="outline-none">
                    <div className="flex h-12 items-center justify-between border-b border-panel-border px-4">
                        <h2 className="text-[13px] font-semibold">{title}</h2>
                        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-panel-hover">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="p-4" onKeyDown={(e) => e.stopPropagation()}>
                        {children}
                    </div>
                    {footer && <div className="flex justify-end gap-2 border-t border-panel-border px-4 py-3">{footer}</div>}
                </AriaDialog>
            </AriaModal>
        </AriaModalOverlay>
    );
}

function Cancel({ onPress }: { onPress: () => void }) {
    return (
        <button type="button" onClick={onPress} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
            Cancel
        </button>
    );
}

const close = () => docView.set({ dialog: null });

// ---- Signature ----

function DrawPad({ onChange }: { onChange: (strokes: [number, number][][]) => void }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<[number, number][][]>([]);
    const drawing = useRef(false);
    const W = 400;
    const H = 140;
    const paint = () => {
        const ctx = ref.current?.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, W * 2, H * 2);
        ctx.strokeStyle = "#0d1a59";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const s of strokes.current) {
            ctx.beginPath();
            s.forEach(([x, y], i) => (i ? ctx.lineTo(x * 2, y * 2) : ctx.moveTo(x * 2, y * 2)));
            ctx.stroke();
        }
    };
    const pos = (e: React.PointerEvent): [number, number] => {
        const r = ref.current?.getBoundingClientRect();
        return r ? [e.clientX - r.left, e.clientY - r.top] : [0, 0];
    };
    return (
        <div>
            <canvas
                ref={ref}
                width={W * 2}
                height={H * 2}
                aria-label="Draw your signature"
                className="touch-none rounded-md border border-panel-border bg-white"
                style={{ width: W, height: H, cursor: "crosshair" }}
                onPointerDown={(e) => {
                    drawing.current = true;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    strokes.current.push([pos(e)]);
                    paint();
                }}
                onPointerMove={(e) => {
                    if (!drawing.current) return;
                    strokes.current[strokes.current.length - 1]?.push(pos(e));
                    paint();
                }}
                onPointerUp={() => {
                    drawing.current = false;
                    onChange(strokes.current.filter((s) => s.length > 1));
                }}
            />
            <button
                type="button"
                onClick={() => {
                    strokes.current = [];
                    paint();
                    onChange([]);
                }}
                className="mt-1 text-[11px] text-ink-muted hover:text-ink"
            >
                Clear
            </button>
        </div>
    );
}

// Strokes drawn in the pad, cropped to their ink and scaled to 0..1 of that box.
function normalize(strokes: [number, number][][]): { strokes: [number, number][][]; aspect: number } | null {
    const pts = strokes.flat();
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    return { strokes: strokes.map((s) => s.map(([x, y]) => [(x - x0) / w, (y - y0) / h] as [number, number])), aspect: w / h };
}

export function SignatureDialog() {
    const open = useDoc((s) => s.dialog === "signature");
    const [tab, setTab] = useState<"draw" | "type" | "image">("draw");
    const [drawn, setDrawn] = useState<[number, number][][]>([]);
    const [typed, setTyped] = useState("");
    const [image, setImage] = useState<{ name: string; bytes: Uint8Array; aspect: number; url: string } | null>(null);
    const saved = open ? rememberedSignature() : null;
    const ready = tab === "draw" ? drawn.length > 0 : tab === "type" ? typed.trim().length > 0 : Boolean(image);
    const confirm = () => {
        if (tab === "draw") {
            const n = normalize(drawn);
            if (n) chooseSignature({ kind: "draw", ...n });
        } else if (tab === "type") chooseSignature({ kind: "type", text: typed.trim() });
        else if (image) chooseSignature({ kind: "image", name: image.name, bytes: image.bytes, aspect: image.aspect });
        editor.notify("Click on the page to place your signature.");
    };
    return (
        <Modal
            title="Add a signature"
            open={open}
            onClose={close}
            width={460}
            footer={
                <>
                    {saved && (
                        <button type="button" onClick={() => (chooseSignature(saved), editor.notify("Click on the page to place your signature."))} className="mr-auto h-8 rounded-md px-3 text-[12px] text-ink hover:bg-panel-hover">
                            Use saved signature
                        </button>
                    )}
                    {saved && (
                        <button type="button" onClick={() => forgetSignature()} className="h-8 rounded-md px-3 text-[12px] text-ink-muted hover:bg-panel-hover">
                            Forget saved
                        </button>
                    )}
                    <Cancel onPress={close} />
                    <button type="button" disabled={!ready} onClick={confirm} className={primary} style={{ background: DOC_BLUE }}>
                        Place
                    </button>
                </>
            }
        >
            <div className="mb-3 flex gap-1">
                {(
                    [
                        ["draw", "Draw"],
                        ["type", "Type"],
                        ["image", "Upload image"],
                    ] as const
                ).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${tab === id ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`}>
                        {label}
                    </button>
                ))}
            </div>
            {tab === "draw" && <DrawPad onChange={setDrawn} />}
            {tab === "type" && (
                <div className="space-y-2">
                    <input autoFocus aria-label="Your name" value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" className={`${field} h-9`} />
                    <div className="flex h-24 items-center justify-center rounded-md border border-panel-border bg-white text-[34px] text-[#0d1a59]" style={{ fontFamily: "'Dancing Script', 'Snell Roundhand', cursive" }}>
                        {typed || " "}
                    </div>
                </div>
            )}
            {tab === "image" && (
                <div className="space-y-2">
                    <label className="flex h-24 cursor-pointer items-center justify-center rounded-md border border-dashed border-panel-border bg-white text-[12px] text-black/60">
                        {image ? <img src={image.url} alt="Signature" className="max-h-20 max-w-full" /> : "Choose a PNG or JPEG of your signature"}
                        <input
                            type="file"
                            accept="image/png,image/jpeg"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const bytes = new Uint8Array(await file.arrayBuffer());
                                const url = URL.createObjectURL(file);
                                const img = new Image();
                                img.onload = () => setImage({ name: file.name, bytes, url, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) });
                                img.src = url;
                            }}
                        />
                    </label>
                </div>
            )}
        </Modal>
    );
}

// ---- Protect ----

export function ProtectDialog() {
    const open = useDoc((s) => s.dialog === "protect");
    const info = useDoc((s) => s.info);
    const [openPw, setOpenPw] = useState("");
    const [openPw2, setOpenPw2] = useState("");
    const [permPw, setPermPw] = useState("");
    const [printing, setPrinting] = useState("high");
    const [changes, setChanges] = useState("none");
    const [copy, setCopy] = useState(false);
    useEffect(() => {
        if (open) {
            setOpenPw("");
            setOpenPw2("");
            setPermPw("");
        }
    }, [open]);
    const encrypted = Boolean(info?.encrypted || info?.security);
    // The open password can't be recovered, so it's typed twice: a typo would lock the file for good.
    const mismatch = Boolean(openPw) && openPw !== openPw2;
    const apply = async () => {
        if (mismatch) return;
        if (edit({ op: "protect", openPassword: openPw, permissionsPassword: permPw, printing, changes, copy })) {
            close();
            if (await saveNow(true)) editor.notify(openPw ? "Protected. The PDF now asks for its password to open." : "Protected. Changes now need the permissions password.");
        }
    };
    return (
        <Modal
            title="Protect with a password"
            open={open}
            onClose={close}
            footer={
                <>
                    {encrypted && (
                        <button
                            type="button"
                            onClick={async () => {
                                if (edit({ op: "removeProtection" })) {
                                    close();
                                    if (await saveNow(true)) editor.notify("Password protection removed.");
                                }
                            }}
                            className="mr-auto h-8 rounded-md px-3 text-[12px] text-red-400 hover:bg-panel-hover"
                        >
                            Remove protection
                        </button>
                    )}
                    <Cancel onPress={close} />
                    <button type="button" disabled={(!openPw && !permPw) || mismatch} onClick={() => void apply()} className={primary} style={{ background: DOC_BLUE }}>
                        Protect
                    </button>
                </>
            }
        >
            <div className="space-y-3 text-[12px]">
                {encrypted && <p className="rounded-md bg-panel-hover px-3 py-2 text-ink-muted">This PDF is protected{info?.security?.method ? ` (${info.security.method})` : ""}.</p>}
                <label className="block space-y-1">
                    <span className="text-[11px] text-ink-muted">Password to open the document</span>
                    <input type="password" autoComplete="new-password" value={openPw} onChange={(e) => setOpenPw(e.target.value)} className={`${field} h-8`} placeholder="Leave empty to open freely" />
                </label>
                {openPw && (
                    <label className="block space-y-1">
                        <span className="text-[11px] text-ink-muted">Type the password again</span>
                        <input type="password" autoComplete="new-password" aria-invalid={mismatch && openPw2.length > 0} value={openPw2} onChange={(e) => setOpenPw2(e.target.value)} className={`${field} h-8`} />
                        {mismatch && openPw2.length > 0 && <span className="block text-[11px] text-red-400">The passwords don't match.</span>}
                    </label>
                )}
                <label className="block space-y-1">
                    <span className="text-[11px] text-ink-muted">Permissions password (to change what's allowed)</span>
                    <input type="password" autoComplete="new-password" value={permPw} onChange={(e) => setPermPw(e.target.value)} className={`${field} h-8`} placeholder="Leave empty to allow everything" />
                </label>
                <div className={`grid grid-cols-2 gap-3 ${permPw ? "" : "pointer-events-none opacity-40"}`}>
                    <label className="block space-y-1">
                        <span className="text-[11px] text-ink-muted">Printing allowed</span>
                        <Select aria-label="Printing allowed" value={printing} onChange={(e) => setPrinting(e.target.value)} className="h-8 w-full rounded-md border border-panel-border bg-field px-2 text-ink">
                            <option value="high">High resolution</option>
                            <option value="low">Low resolution</option>
                            <option value="none">None</option>
                        </Select>
                    </label>
                    <label className="block space-y-1">
                        <span className="text-[11px] text-ink-muted">Changes allowed</span>
                        <Select aria-label="Changes allowed" value={changes} onChange={(e) => setChanges(e.target.value)} className="h-8 w-full rounded-md border border-panel-border bg-field px-2 text-ink">
                            <option value="none">None</option>
                            <option value="pages">Inserting, deleting, rotating pages</option>
                            <option value="fill">Filling in forms and signing</option>
                            <option value="comment">Commenting, filling in and signing</option>
                            <option value="any">Anything except extracting pages</option>
                        </Select>
                    </label>
                    <label className="col-span-2 flex items-center gap-2">
                        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Allow copying text and images
                    </label>
                </div>
                <p className="text-[11px] text-ink-subtle">Encrypted with AES-256. Keep the passwords somewhere safe: they can't be recovered.</p>
            </div>
        </Modal>
    );
}

// ---- Password to open ----

export function PasswordPrompt() {
    const status = useDoc((s) => s.status);
    const error = useDoc((s) => s.error);
    const [pw, setPw] = useState("");
    if (status !== "password") return null;
    return (
        <div className="flex h-full items-center justify-center">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    unlock(pw);
                }}
                className="w-80 space-y-3 rounded-xl border border-panel-border bg-panel-raised p-5 text-ink shadow-xl"
            >
                <h2 className="text-[13px] font-semibold">This PDF is protected</h2>
                <p className="text-[12px] text-ink-muted">Enter its password to open it.</p>
                <input autoFocus type="password" aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={`${field} h-9`} />
                {error && <p className="text-[11px] text-red-400">{error}</p>}
                <button type="submit" className={`${primary} w-full`} style={{ background: DOC_BLUE }}>
                    Open
                </button>
            </form>
        </div>
    );
}

// ---- Split ----

export function SplitDialog() {
    const open = useDoc((s) => s.dialog === "split");
    const pages = useDoc((s) => s.info?.pages.length ?? 0);
    const [every, setEvery] = useState(1);
    const split = async () => {
        const wb = workbench();
        if (!wb) return;
        const files: { name: string; blob: Blob }[] = [];
        try {
            for (let start = 0; start < pages; start += every) {
                const list = Array.from({ length: Math.min(every, pages - start) }, (_, k) => start + k);
                const bytes = wb.extract(JSON.stringify(list));
                const end = start + list.length;
                files.push({ name: `${fileBase()} ${start + 1}${end > start + 1 ? `-${end}` : ""}.pdf`, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
            }
        } catch (error) {
            editor.notify(error instanceof Error ? error.message : String(error));
            return;
        }
        const { zipFiles } = await import("../engine/export");
        if (files.length === 1 && files[0]) download(files[0].blob, files[0].name);
        else download(await zipFiles(files), `${fileBase()} split.zip`);
        close();
    };
    const parts = Math.ceil(pages / Math.max(1, every));
    return (
        <Modal
            title="Split into files"
            open={open}
            onClose={close}
            width={360}
            footer={
                <>
                    <Cancel onPress={close} />
                    <button type="button" onClick={() => void split()} className={primary} style={{ background: DOC_BLUE }}>
                        Split
                    </button>
                </>
            }
        >
            <label className="flex items-center gap-2 text-[12px]">
                Every
                <input type="number" min={1} max={Math.max(1, pages)} value={every} onChange={(e) => setEvery(Math.max(1, Math.min(pages, Number(e.target.value) || 1)))} className={`${field} h-8 w-20`} />
                pages
            </label>
            <p className="mt-2 text-[11px] text-ink-muted">
                {parts === 1 ? "One file: the whole document." : `${parts} files, downloaded together as a zip.`}
            </p>
        </Modal>
    );
}

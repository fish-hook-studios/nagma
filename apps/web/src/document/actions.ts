import { download, zipFiles } from "../engine/export";
import { storeImage } from "../engine/image-store";
import { editor } from "../engine/store";
import { loadPdfEngine } from "../engines/pdf-engine";
import { PDF_KEY, formatBytes } from "./model";
import { docView, drawInto, fileBase, rectJson, run, saveNow, syncWorkbench, workbench } from "./state";

// Workbench commands that go beyond a single engine edit: files in and out, printing,
// compressing.

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = multiple;
        input.onchange = () => resolve(Array.from(input.files ?? []));
        input.click();
    });
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

// A file as PDF bytes: PDFs as they are, pictures as a page each. The engine reads PNG, JPEG,
// TIFF, GIF and BMP; other pictures the browser can show (WebP, SVG, AVIF) go in as PNG.
export async function asPdf(file: File): Promise<Uint8Array> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isPdf(file)) return bytes;
    const engine = await loadPdfEngine();
    try {
        return engine.PdfWorkbench.fromImage(file.name, bytes);
    } catch {
        // Not one the engine reads: the browser's decoder tries (its own message repeated the
        // file name and listed formats that excluded WebP, which Nagma opens everywhere else).
    }
    const png = await pictureAsPng(file);
    if (!png) throw new Error("it isn't a PDF or a picture Nagma can read.");
    return engine.PdfWorkbench.fromImage(file.name.replace(/\.[^.]+$/, "") + ".png", png);
}

async function pictureAsPng(file: File): Promise<Uint8Array | null> {
    // An <img> decodes what createImageBitmap won't take from a blob (SVG).
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (!img.naturalWidth || !img.naturalHeight) return null;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Insert pages from PDFs (or pictures) at `at`; the end when not given (Merge files).
export async function insertFiles(at?: number) {
    const files = await pickFiles(".pdf,application/pdf,image/*", true);
    await insertFileList(files, at ?? docView.get().info?.pages.length ?? 0);
}

// Inserts the pages of each file (PDFs, pictures as a page each) at `at`, in order. A file that
// can't be read is reported with the others, and the files after it still go in. Returns how many
// went in.
export async function insertFileList(files: File[], at: number): Promise<number> {
    let pos = at;
    const added: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
        try {
            const bytes = await asPdf(file);
            const before = workbench()?.pageCount() ?? 0;
            if (!run((w) => w.insertPdf(pos, file.name, bytes), {}, true)) return added.length;
            pos += (workbench()?.pageCount() ?? before) - before;
            added.push(file.name);
        } catch {
            failed.push(file.name);
        }
    }
    const couldnt = failed.length ? ` Couldn't add ${failed.join(", ")}: not a PDF or picture Nagma can read.` : "";
    const ok = added.length === 1 ? `Added ${added[0]}.` : added.length ? `Added ${added.length} files.` : "";
    if (added.length || failed.length) editor.notify(`${ok}${couldnt}`.trim());
    return added.length;
}

export function extractPages(pages: number[]) {
    const w = workbench();
    if (!w || !pages.length) return;
    try {
        const bytes = w.extract(JSON.stringify([...pages].sort((a, b) => a - b)));
        download(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${fileBase()} pages ${pages.map((p) => p + 1).join(",")}.pdf`);
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

function pageBlob(page: number, scale: number): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    drawInto(page, scale, canvas);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function exportImages(scale = 2) {
    const pages = docView.get().info?.pages.length ?? 0;
    const files: { name: string; blob: Blob }[] = [];
    for (let p = 0; p < pages; p++) {
        const blob = await pageBlob(p, scale);
        if (blob) files.push({ name: `${fileBase()} ${p + 1}.png`, blob });
    }
    if (files.length === 1 && files[0]) download(files[0].blob, files[0].name);
    else if (files.length) download(await zipFiles(files), `${fileBase()} pages.zip`);
}

export function exportText() {
    const w = workbench();
    if (!w) return;
    const pages = w.pageCount();
    const parts: string[] = [];
    for (let p = 0; p < pages; p++) parts.push(w.plainText(p));
    download(new Blob([parts.join("\n\f\n")], { type: "text/plain;charset=utf-8" }), `${fileBase()}.txt`);
}

// Prints the pages as the workbench draws them, through a hidden frame.
export async function printDocument() {
    const info = docView.get().info;
    if (!info) return;
    if (!info.allows.print) {
        editor.notify("This PDF's permissions don't allow printing.");
        return;
    }
    editor.notify("Preparing to print…");
    const urls: string[] = [];
    for (let p = 0; p < info.pages.length; p++) {
        const blob = await pageBlob(p, 2);
        if (blob) urls.push(URL.createObjectURL(blob));
    }
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const d = frame.contentDocument;
    if (!d) return;
    d.open();
    d.write(
        `<!doctype html><title>${fileBase()}</title><style>@page{margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always;break-after:page}</style>${urls.map((u) => `<img src="${u}">`).join("")}`,
    );
    d.close();
    const imgs = Array.from(d.images);
    await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => {
        frame.remove();
        for (const u of urls) URL.revokeObjectURL(u);
    }, 60_000);
}

// Reduce File Size: the optimized PDF becomes the file's content (undo history starts over).
export async function compressDocument() {
    const w = workbench();
    if (!w || editor.get().readOnly) return;
    if (docView.get().saving !== "saved") await saveNow();
    const before = docView.get().info?.fileSize ?? 0;
    try {
        const bytes = w.reduced();
        if (before && bytes.length >= before) {
            editor.notify(`Already compact (${formatBytes(before)}); nothing to reduce.`);
            return;
        }
        const ref = await storeImage(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        editor.execute({ type: "image.set", id: PDF_KEY, data: ref });
        await syncWorkbench(true);
        editor.notify(`Reduced from ${formatBytes(before)} to ${formatBytes(bytes.length)}.`);
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

// Edit text and images ▸ Add image, centred on the page in view.
export async function addImageToPage(page: number) {
    const [file] = await pickFiles("image/png,image/jpeg,image/gif,image/bmp");
    const p = docView.get().info?.pages[page];
    if (!file || !p) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 200, h: 150 });
        img.src = URL.createObjectURL(file);
    });
    const w = Math.min(p.width * 0.6, size.w);
    const h = (w * size.h) / Math.max(1, size.w);
    const x = (p.width - w) / 2;
    const y = (p.height - h) / 2;
    run((wb) => wb.addImage(page, rectJson([x, y, x + w, y + h]), file.name, bytes));
}

export async function replacePageImage(page: number, index: number) {
    const [file] = await pickFiles("image/png,image/jpeg,image/gif,image/bmp,image/tiff");
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    run((wb) => wb.replaceImage(page, index, file.name, bytes), { imageSel: { page, index } });
}

export function saveAttachment(index: number, name: string) {
    const w = workbench();
    if (!w) return;
    try {
        download(new Blob([w.attachment(index) as BlobPart]), name);
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

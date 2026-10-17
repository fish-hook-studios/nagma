import { MAX_IMAGE_BYTES, sniffImageType } from "./clipboard-images";
import { placeImages } from "./images";

// Images pasted from elsewhere: a screenshot or a copied picture (image data on the clipboard),
// files copied in the Finder, a web page's <img> (its link or a data: URI), or a link to an image.
// Every product's canvas pastes them the same way, as layers with image fills (engine/images.ts).

// A link straight to an image file.
export const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?\S*)?$/i;

export const isImageUrl = (text: string) => IMAGE_URL.test(text.trim());

// Files on the clipboard that paste as layers: pictures and PDFs, from `files` or, where a browser
// lists them only there, from `items`.
export function clipboardFiles(data: DataTransfer | null | undefined): File[] {
    if (!data) return [];
    const usable = (f: File | null): f is File => Boolean(f && (f.type.startsWith("image/") || f.type === "application/pdf"));
    const files = Array.from(data.files ?? []).filter(usable);
    if (files.length) return files;
    return Array.from(data.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(usable);
}

// The pictures in pasted HTML, when they are all it shows (a copied image, not a paragraph with an
// icon in it): https links and data: URIs.
export function htmlImageSources(html: string): string[] {
    if (!/<img\b/i.test(html)) return [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    if ((doc.body.textContent ?? "").trim()) return [];
    return Array.from(doc.querySelectorAll("img"))
        .map((img) => img.getAttribute("src")?.trim() ?? "")
        .filter((src) => /^https:\/\//i.test(src) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(src))
        .slice(0, 20);
}

const nameOf = (src: string) => (src.startsWith("data:") ? "Image" : decodeURIComponent(src.split("/").pop()?.split("?")[0] ?? "") || "Image");

// One picture by link or data: URI, as a file to place (null when it can't be read).
async function imageFile(src: string): Promise<File | null> {
    try {
        const res = await fetch(src, src.startsWith("data:") ? undefined : { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.size || blob.size > MAX_IMAGE_BYTES) return null;
        const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
        const type = sniffImageType(head) ?? (/<svg[\s>]/i.test(new TextDecoder().decode(head)) || blob.type === "image/svg+xml" ? "image/svg+xml" : null);
        if (!type) return null;
        const name = nameOf(src);
        return new File([blob], type === "image/svg+xml" && !/\.svg$/i.test(name) ? `${name}.svg` : name, { type });
    } catch {
        return null;
    }
}

// Places the pictures at a point; false when none of them could be read.
export async function placeImageSources(sources: string[], at: { x: number; y: number }): Promise<boolean> {
    const files = (await Promise.all(sources.map(imageFile))).filter((f): f is File => f !== null);
    if (!files.length) return false;
    await placeImages(files, at);
    return true;
}

interface DesktopBridge {
    readClipboardImage?: () => Promise<Uint8Array | null>;
}

// The desktop app: the picture on the system clipboard, for a paste whose event carried none.
export async function desktopClipboardImage(): Promise<File | null> {
    const bridge = (window as unknown as { nagmaDesktop?: DesktopBridge }).nagmaDesktop;
    if (!bridge?.readClipboardImage) return null;
    try {
        const bytes = await bridge.readClipboardImage();
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE_BYTES || sniffImageType(bytes) !== "image/png") return null;
        return new File([bytes as BlobPart], "Pasted image.png", { type: "image/png" });
    } catch {
        return null;
    }
}

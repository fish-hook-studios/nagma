import { type RasterOptions, renderNodesToPng } from "../canvas/render";
import { exportRegionSvg, exportSvg } from "./export-svg";
import { exportBounds } from "./effect-bounds";
import { renderRegion } from "../canvas/export-render";
import { ensureLiveSnapshots } from "../canvas/live-snapshots";
import { worldBounds } from "./transform";
import { exportMotion, type MotionFormat } from "./motion";
import { inlineImages } from "./image-store";
import { selectionBounds } from "./nodes";
import { startScreen } from "./prototype";
import { refuseExport } from "./share-settings";
import type { ExportSetting, NagmaDocument, SceneNode } from "./types";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf" | MotionFormat;

export const MOTION_FORMATS: MotionFormat[] = ["mp4", "webm", "gif", "lottie", "dotlottie", "svganim"];

export function isMotionFormat(format: ExportFormat): format is MotionFormat {
    return (MOTION_FORMATS as string[]).includes(format);
}

export function download(blob: Blob, name: string) {
    // Every export and saved copy comes through here; view-only people may be barred from it.
    if (refuseExport()) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Layer";
}

// Builds one PDF with a page per layer, each page the layer's size, drawn as vectors. The quality
// sets how the PDF's streams are compressed (high leaves them as they are).
export async function buildPdf(input: NagmaDocument, ids: string[], quality: ExportSetting["pdfQuality"] = "medium"): Promise<Blob | null> {
    // Live frames are written as their pictures: bring them up to date first.
    await ensureLiveSnapshots(input, ids);
    const doc = await inlineImages(input);
    // Loaded only when exporting, so the PDF libraries don't slow down opening the editor.
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const id of ids) {
        const svg = exportSvg(doc, id);
        // The page is the SVG's own size (the layer with its shadows and unclipped contents).
        const node = doc.nodes[id];
        const box = node?.isSlice ? worldBounds(doc, node) : node ? exportBounds(doc, node) : null;
        if (!svg || !box) continue;
        const size: [number, number] = [Math.max(1, box.w), Math.max(1, box.h)];
        const orientation = size[0] > size[1] ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, orientation, compress: quality !== "high", precision: quality === "low" ? 2 : 16 });
        else pdf.addPage(size, orientation);
        const element = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        // svg2pdf reads layout from the live DOM, so the SVG is attached off-screen while it converts.
        const holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-100000px;top:0;";
        holder.appendChild(element);
        document.body.appendChild(holder);
        try {
            await svg2pdf(element, pdf, { x: 0, y: 0, width: size[0], height: size[1] });
        } finally {
            holder.remove();
        }
    }
    return pdf ? pdf.output("blob") : null;
}

// Exports layers in a format. PDF puts every layer on its own page of one file; the others save a file each.
export async function exportLayers(input: NagmaDocument, ids: string[], format: ExportFormat, scale: number) {
    // Self-contained files carry their images inline.
    const doc = format === "svg" || format === "pdf" ? await inlineImages(input) : input;
    const named = ids.map((id) => doc.nodes[id]).filter((n) => n !== undefined);
    if (!named.length) return;
    if (isMotionFormat(format)) {
        // A motion export follows the prototype flow from the selection's screen.
        const screen = startScreen(doc, ids);
        if (!screen) throw new Error("No screen to animate");
        await exportMotion(doc, screen, format, scale);
        return;
    }
    if (format === "pdf") {
        const blob = await buildPdf(doc, ids);
        if (blob) download(blob, `${safeName(named.length === 1 ? (named[0]?.name ?? doc.name) : doc.name)}.pdf`);
        return;
    }
    if (format === "svg") await ensureLiveSnapshots(doc, ids);
    for (const node of named) {
        if (format === "svg") {
            const svg = exportSvg(doc, node.id);
            if (svg) download(new Blob([svg], { type: "image/svg+xml" }), `${safeName(node.name)}.svg`);
            continue;
        }
        const blob = node.isSlice
            ? (await renderExport(doc, node.id, { format, scale, suffix: "" }))?.blob
            : await renderNodesToPng(doc, node, scale, format === "jpg" ? "jpeg" : "png");
        if (blob) download(blob, `${safeName(node.name)}${scale === 1 ? "" : `@${scale}x`}.${format}`);
    }
}

// Export settings (the reference's export rows): every layer can carry several, each a size, a format, a
// suffix and options. One file downloads as itself; several come as one zip.

export const DEFAULT_SETTING: ExportSetting = { format: "png", scale: 1, suffix: "", svgSimplifyStroke: true, contentsOnly: true, jpgQuality: 0.9, pdfQuality: "medium", resampling: "smooth", colorProfile: "document" };

// The raster options a setting asks for (the document's colour profile when it says "document").
export function rasterOptions(doc: NagmaDocument, setting: ExportSetting): RasterOptions {
    const profile = setting.colorProfile === "document" || !setting.colorProfile ? (doc.colorProfile ?? "srgb") : setting.colorProfile;
    return {
        quality: setting.format === "jpg" ? Math.min(1, Math.max(0.05, setting.jpgQuality ?? 0.9)) : undefined,
        resampling: setting.resampling ?? "smooth",
        colorSpace: profile === "p3" ? "display-p3" : "srgb",
        absoluteBounds: Boolean(setting.absoluteBounds),
    };
}

function pageOfNode(doc: NagmaDocument, id: string): string | null {
    let cur: SceneNode | undefined = doc.nodes[id];
    while (cur && cur.type !== "page") cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
    return cur?.id ?? null;
}

// The scale a setting asks for, given the layer's size.
export function settingScale(setting: ExportSetting, box: { w: number; h: number }): number {
    if (setting.constraint === "width" && setting.size && box.w > 0) return setting.size / box.w;
    if (setting.constraint === "height" && setting.size && box.h > 0) return setting.size / box.h;
    return setting.scale || 1;
}

export function settingLabel(setting: ExportSetting): string {
    if (setting.constraint === "width" && setting.size) return `${setting.size}w`;
    if (setting.constraint === "height" && setting.size) return `${setting.size}h`;
    return `${setting.scale}x`;
}

// "2x", "0.5", "512w", "200h" → the size part of a setting.
export function parseSize(text: string): Pick<ExportSetting, "scale" | "constraint" | "size"> | null {
    const t = text.trim().toLowerCase();
    const m = t.match(/^(\d*\.?\d+)\s*(x|w|h|px)?$/);
    if (!m) return null;
    const n = parseFloat(m[1] ?? "");
    if (!Number.isFinite(n) || n <= 0) return null;
    if (m[2] === "w" || m[2] === "px") return { scale: 1, constraint: "width", size: Math.round(n) };
    if (m[2] === "h") return { scale: 1, constraint: "height", size: Math.round(n) };
    return { scale: Math.min(32, n), constraint: "scale", size: undefined };
}

export interface ExportFile {
    name: string;
    blob: Blob;
}

// One file for one layer and one setting.
export async function renderExport(input: NagmaDocument, id: string, setting: ExportSetting): Promise<ExportFile | null> {
    const doc = setting.format === "svg" || setting.format === "pdf" ? await inlineImages(input) : input;
    const node = doc.nodes[id];
    if (!node) return null;
    const box = node.isSlice ? worldBounds(doc, node) : selectionBounds(doc, [id]);
    if (!box) return null;
    const base = `${safeName(node.name)}${setting.suffix ?? ""}`;
    const page = pageOfNode(doc, id);
    const region = node.isSlice || setting.contentsOnly === false;
    if (setting.format === "svg") {
        await ensureLiveSnapshots(doc, region && page ? (doc.nodes[page]?.children ?? []) : [id]);
        const options = { includeId: setting.svgIncludeId, simplifyStroke: setting.svgSimplifyStroke ?? true, outlineText: setting.svgOutlineText };
        const svg = region && page && !node.isSlice ? exportRegionSvg(doc, page, worldBounds(doc, node), options) : exportSvg(doc, id, options);
        return svg ? { name: `${base}.svg`, blob: new Blob([svg], { type: "image/svg+xml" }) } : null;
    }
    if (setting.format === "pdf") {
        const blob = await buildPdf(doc, [id], setting.pdfQuality ?? "medium");
        return blob ? { name: `${base}.pdf`, blob } : null;
    }
    const scale = settingScale(setting, box);
    const type = setting.format === "jpg" ? "jpeg" : "png";
    const options = rasterOptions(doc, setting);
    const blob = region && page ? await renderRegion(doc, page, node.isSlice ? box : worldBounds(doc, node), scale, type, options) : await renderNodesToPng(doc, node, scale, type, options);
    return blob ? { name: `${base}.${setting.format}`, blob } : null;
}

// Several files as a zip (names made unique).
export async function zipFiles(files: ExportFile[]): Promise<Blob> {
    const { zipSync } = await import("fflate");
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) {
        let name = f.name;
        let n = 2;
        while (entries[name]) name = f.name.replace(/(\.[^.]+)$/, ` ${n++}$1`);
        entries[name] = new Uint8Array(await f.blob.arrayBuffer());
    }
    return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: "application/zip" });
}

// Exports layers with their settings (or the given ones): one file downloads, several zip up.
export async function exportWithSettings(doc: NagmaDocument, ids: string[], settingsFor: (id: string) => ExportSetting[], zipName?: string): Promise<number> {
    const files: ExportFile[] = [];
    for (const id of ids) {
        for (const setting of settingsFor(id)) {
            const file = await renderExport(doc, id, setting);
            if (file) files.push(file);
        }
    }
    if (!files.length) return 0;
    if (files.length === 1) download((files[0] as ExportFile).blob, (files[0] as ExportFile).name);
    else download(await zipFiles(files), `${safeName(zipName ?? doc.name ?? "Export")}.zip`);
    return files.length;
}

import { download, renderExport, safeName, zipFiles, type ExportFile } from "../engine/export";
import { exportAnimated } from "../engine/motion";
import { preloadImages } from "../engine/image-store";
import type { ExportSetting, NagmaDocument } from "../engine/types";
import { assetData, rowName } from "./model";
import { hasVideoIn, recordWebm, renderMp4 } from "./video";

// Exports assets: one file per asset (or per export setting the asset carries), zipped with a
// folder per row and the asset's name as the file name. Assets with video (or Motion keyframes)
// can go out as MP4 or WebM; the rest come as pictures in their place.

export type CampaignFormat = "png" | "jpg" | "pdf" | "mp4" | "webm";
export type ColorProfile = NonNullable<ExportSetting["colorProfile"]>;

export interface AssetExportChoice {
    format: CampaignFormat;
    scale: number;
}

export interface CampaignExport {
    ids: string[];
    format: CampaignFormat;
    scale: number;
    colorProfile?: ColorProfile;
    // Use each asset's own export settings when it has any.
    useAssetSettings: boolean;
    // Choices made for single assets in the export dialog's sidebar.
    overrides?: Record<string, AssetExportChoice>;
}

export function isAnimated(doc: NagmaDocument, id: string): boolean {
    const node = doc.nodes[id];
    if (!node) return false;
    if (node.animation && Object.keys(node.animation.tracks ?? {}).length) return true;
    return node.children.some((c) => isAnimated(doc, c));
}

// Whether an asset can go out as a video: it has a video in it, or Motion keyframes.
export const isMoving = (doc: NagmaDocument, id: string) => hasVideoIn(doc, id) || isAnimated(doc, id);

export const isVideoFormat = (f: CampaignFormat) => f === "mp4" || f === "webm";

export function choiceFor(id: string, options: CampaignExport): AssetExportChoice {
    return options.overrides?.[id] ?? { format: options.format, scale: options.scale };
}

export function settingsFor(doc: NagmaDocument, id: string, options: CampaignExport): ExportSetting[] {
    const own = doc.nodes[id]?.exportSettings;
    const override = options.overrides?.[id];
    if (!override && options.useAssetSettings && own?.length) return own.map((s) => ({ ...s, colorProfile: s.colorProfile ?? options.colorProfile }));
    const choice = choiceFor(id, options);
    const format = isVideoFormat(choice.format) ? "png" : choice.format;
    return [{ format, scale: choice.scale, suffix: "", contentsOnly: true, colorProfile: options.colorProfile }];
}

export async function campaignFiles(doc: NagmaDocument, options: CampaignExport, onProgress?: (done: number, total: number) => void): Promise<ExportFile[]> {
    await preloadImages(doc.images);
    const files: ExportFile[] = [];
    let done = 0;
    for (const id of options.ids) {
        const node = doc.nodes[id];
        const data = assetData(node);
        if (!node) continue;
        const folder = data ? safeName(rowName(doc, data.rowId)) : "";
        const choice = choiceFor(id, options);
        if (isVideoFormat(choice.format) && hasVideoIn(doc, id)) {
            const blob = choice.format === "mp4" ? await renderMp4(doc, id, choice.scale) : await recordWebm(doc, id, choice.scale);
            const name = `${safeName(node.name)}.${choice.format}`;
            files.push({ name: folder ? `${folder}/${name}` : name, blob });
        } else {
            for (const setting of settingsFor(doc, id, options)) {
                const file = await renderExport(doc, id, setting);
                if (file) files.push({ ...file, name: folder ? `${folder}/${file.name}` : file.name });
            }
        }
        onProgress?.(++done, options.ids.length);
    }
    return files;
}

// Builds the export and downloads it. Returns how many files went out.
export async function exportCampaign(doc: NagmaDocument, options: CampaignExport, onProgress?: (done: number, total: number) => void): Promise<{ files: number; videos: number; blob: Blob | null }> {
    let videos = 0;
    let ids = options.ids;
    // Assets moving only by Motion keyframes record through the design editor's animated export
    // (each its own download); videos render here, alongside the pictures.
    const keyframed = ids.filter((id) => isVideoFormat(choiceFor(id, options).format) && !hasVideoIn(doc, id) && isAnimated(doc, id));
    for (const id of keyframed) {
        const choice = choiceFor(id, options);
        await exportAnimated(doc, id, { format: choice.format === "webm" ? "webm" : "mp4", scale: choice.scale, fps: 30, quality: 0.7 });
        videos++;
    }
    ids = ids.filter((id) => !keyframed.includes(id));
    videos += ids.filter((id) => isVideoFormat(choiceFor(id, options).format) && hasVideoIn(doc, id)).length;
    const files = await campaignFiles(doc, { ...options, ids }, onProgress);
    if (!files.length) return { files: 0, videos, blob: null };
    if (files.length === 1) {
        const only = files[0] as ExportFile;
        const name = only.name.split("/").pop() ?? only.name;
        download(only.blob, name);
        return { files: 1, videos, blob: only.blob };
    }
    const blob = await zipFiles(files);
    download(blob, `${safeName(doc.name || "Campaign")}.zip`);
    return { files: files.length, videos, blob };
}

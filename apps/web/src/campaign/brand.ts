import { nanoid } from "nanoid";
import { renderNodesToPng } from "../canvas/render";
import { preloadImages, storeImage } from "../engine/image-store";
import { libraryPreviewDoc, loadManifest } from "../engine/library";
import { editor } from "../engine/store";
import type { Command, NagmaDocument } from "../engine/types";
import { brandOf, pageDataCommand } from "./model";
import type { BrandKit } from "./types";

// The brand kit: colours, type styles and logos. It can be pulled from a published design library
// (its colour and text styles, and components named like "Logo"), or from this file's own styles.
// Editors' colour choices are limited to the kit's palette on fields marked brand only.

function kitCommand(doc: NagmaDocument, brand: BrandKit, extra: Command[] = []): Command[] {
    const data = pageDataCommand(doc, { brand });
    return data ? [...extra, data] : extra;
}

export function setBrand(patch: Partial<BrandKit>) {
    const doc = editor.get().doc;
    editor.execute({ type: "batch", commands: kitCommand(doc, { ...brandOf(doc), ...patch }) });
}

export async function pullBrandFromLibrary(libraryId: string): Promise<{ colors: number; texts: number; logos: number }> {
    const manifest = await loadManifest(libraryId, true);
    if (!manifest) throw new Error("That library couldn't be loaded.");
    const colors = manifest.styles.flatMap((s) => (s.kind === "color" && s.style.paint.type === "solid" ? [{ name: s.style.name, color: s.style.paint.color }] : []));
    const texts = manifest.styles.flatMap((s) => (s.kind === "text" ? [{ name: s.style.name, fontFamily: s.style.fontFamily, fontSize: s.style.fontSize, fontWeight: s.style.fontWeight }] : []));
    const extra: Command[] = [];
    const logos: BrandKit["logos"] = [];
    for (const entry of manifest.components.filter((c) => /logo|brand ?mark|wordmark/i.test(c.name)).slice(0, 8)) {
        const preview = await libraryPreviewDoc(libraryId, entry.id, entry.hash);
        const node = preview?.nodes[entry.id];
        if (!preview || !node) continue;
        await preloadImages(preview.images);
        const blob = await renderNodesToPng(preview, node, 2, "png");
        if (!blob) continue;
        const imageId = nanoid(12);
        extra.push({ type: "image.add", id: imageId, data: await storeImage(blob) });
        logos.push({ id: nanoid(8), name: entry.name, imageId });
    }
    const doc = editor.get().doc;
    const current = brandOf(doc);
    const brand: BrandKit = {
        libraryId,
        libraryName: manifest.name,
        colors: colors.length ? colors : current.colors,
        texts: texts.length ? texts : current.texts,
        logos: logos.length ? logos : current.logos,
    };
    editor.execute({ type: "batch", commands: kitCommand(doc, brand, extra) });
    return { colors: colors.length, texts: texts.length, logos: logos.length };
}

// The file's own colour and text styles (made in Design mode) become the kit.
export function pullBrandFromFile(): boolean {
    const doc = editor.get().doc;
    const colors = (doc.styles?.colors ?? []).flatMap((s) => (s.paint.type === "solid" ? [{ name: s.name, color: s.paint.color }] : []));
    const texts = (doc.styles?.texts ?? []).map((s) => ({ name: s.name, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight }));
    if (!colors.length && !texts.length) return false;
    const current = brandOf(doc);
    setBrand({ colors: colors.length ? colors : current.colors, texts: texts.length ? texts : current.texts, libraryId: null, libraryName: null });
    return true;
}

export async function addLogoFile(file: File) {
    const imageId = nanoid(12);
    const data = await storeImage(file);
    const doc = editor.get().doc;
    const brand = brandOf(doc);
    editor.execute({ type: "batch", commands: kitCommand(doc, { ...brand, logos: [...brand.logos, { id: nanoid(8), name: file.name.replace(/\.[^.]+$/, ""), imageId }] }, [{ type: "image.add", id: imageId, data }]) });
}

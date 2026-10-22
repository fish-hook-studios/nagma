import { download } from "./export";
import { blobToDataUrl } from "./image-store";
import { loadMedia, mediaIdsIn, storeMedia } from "./media";
import type { FileKind } from "./files";
import { editor, prepareDocument } from "./store";
import type { NagmaDocument } from "./types";

// A local copy of a file (File › Save local copy) is the document as JSON, with every media
// asset it references (pictures, video and sound files, uploaded fonts: engine/media.ts) embedded
// as a data URL, so the one file opens anywhere: Import… and dropping it on Home bring the media
// back into this browser's store under the same ids and open the document as a new draft.

// The embedded assets, by media store id.
export interface EmbeddedMedia {
    type: string;
    // A data URL of the bytes.
    data: string;
    // The file's name in the media bin, when it had one.
    name?: string;
}

export const LOCAL_COPY_VERSION = 1;

export interface LocalCopy extends NagmaDocument {
    // Only on copies with media in them; documents without media keep the plain shape.
    localCopy?: number;
    media?: Record<string, EmbeddedMedia>;
}

export const LOCAL_COPY_EXTENSION = ".nagma.json";

export function isLocalCopyFile(file: File): boolean {
    return /\.nagma(\.json)?$/i.test(file.name);
}

// The names of the media bin's files, by store id (for the embedded entries).
function mediaNames(doc: NagmaDocument): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of doc.sequence?.edit?.media ?? []) if (m.store && m.name) out.set(m.store, m.name);
    return out;
}

// The document with its media embedded. Media this browser can't find (not stored here, and not
// reachable on the server) is left out; the copy still opens, with those assets missing.
export async function localCopyOf(doc: NagmaDocument): Promise<LocalCopy> {
    const ids = [...mediaIdsIn(doc)];
    if (!ids.length) return doc;
    const names = mediaNames(doc);
    const media: Record<string, EmbeddedMedia> = {};
    for (const id of ids) {
        const blob = await loadMedia(id).catch(() => null);
        if (!blob) continue;
        const name = names.get(id);
        media[id] = { type: blob.type || "application/octet-stream", data: await blobToDataUrl(blob), ...(name ? { name } : {}) };
    }
    if (!Object.keys(media).length) return doc;
    return { ...doc, localCopy: LOCAL_COPY_VERSION, media };
}

export async function localCopyJson(doc: NagmaDocument): Promise<string> {
    return JSON.stringify(await localCopyOf(doc));
}

// File › Save local copy: downloads the open document with its media inside.
export async function saveLocalCopy(doc: NagmaDocument = editor.get().doc): Promise<void> {
    const json = await localCopyJson(doc);
    download(new Blob([json], { type: "application/json" }), `${doc.name || "Untitled"}${LOCAL_COPY_EXTENSION}`);
}

// ---- Opening ----

export function blobFromDataUrl(data: string, fallbackType: string): Blob | null {
    const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(data);
    if (!m) return null;
    const type = m[1] || fallbackType;
    const payload = m[3] ?? "";
    if (!(m[2] ?? "").split(";").includes("base64")) return new Blob([decodeURIComponent(payload)], { type });
    try {
        const raw = atob(payload);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new Blob([bytes], { type });
    } catch {
        return null;
    }
}

export class NotANagmaFile extends Error {}

// The document in a local copy's text, checked to be one: throws NotANagmaFile otherwise. The
// embedded media is returned apart from the document.
export function parseLocalCopy(text: string): { doc: NagmaDocument; media: Record<string, EmbeddedMedia> } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new NotANagmaFile("it isn't a Nagma file.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new NotANagmaFile("it isn't a Nagma file.");
    const { localCopy, media, ...rest } = parsed as LocalCopy;
    const doc = prepareDocument(rest as NagmaDocument);
    if (!doc) throw new NotANagmaFile("it isn't a Nagma file.");
    if (localCopy !== undefined && (typeof localCopy !== "number" || localCopy > LOCAL_COPY_VERSION)) throw new NotANagmaFile("it was saved by a newer Nagma.");
    const assets: Record<string, EmbeddedMedia> = {};
    if (media !== undefined) {
        if (!media || typeof media !== "object" || Array.isArray(media)) throw new NotANagmaFile("its media list is damaged.");
        for (const [id, entry] of Object.entries(media as Record<string, unknown>)) {
            const e = entry as Partial<EmbeddedMedia> | null;
            if (!e || typeof e.data !== "string" || !e.data.startsWith("data:")) throw new NotANagmaFile("its media list is damaged.");
            assets[id] = { type: typeof e.type === "string" ? e.type : "application/octet-stream", data: e.data, ...(typeof e.name === "string" ? { name: e.name } : {}) };
        }
    }
    return { doc, media: assets };
}

// Stores the embedded media under its ids (the store keeps whatever id it's given, so the
// document's references stay as they are). Answers the ids stored.
export async function storeEmbeddedMedia(media: Record<string, EmbeddedMedia>): Promise<string[]> {
    const stored: string[] = [];
    for (const [id, entry] of Object.entries(media)) {
        const blob = blobFromDataUrl(entry.data, entry.type);
        if (!blob) throw new NotANagmaFile("its media list is damaged.");
        await storeMedia(id, blob);
        stored.push(id);
    }
    return stored;
}

// Which product a document belongs to, from the marks the products leave on it.
export function kindOfDocument(doc: NagmaDocument): FileKind {
    if (doc.board) return "board";
    if (doc.slides) return "slides";
    if (doc.campaign) return "campaign";
    if (doc.site) return "site";
    if (doc.make) return "make";
    if (doc.pdf) return "docs";
    if (doc.sequence) return "video";
    return "design";
}

// Opens a local copy as a new file in Drafts, named after the document, with its media stored
// here first. Throws NotANagmaFile for anything that isn't one.
export async function importLocalCopy(file: File): Promise<{ id: string; name: string; kind: FileKind; media: string[] }> {
    const { doc, media } = parseLocalCopy(await file.text());
    const stored = await storeEmbeddedMedia(media);
    const { createFile, openFile } = await import("./files");
    const name = doc.name || file.name.replace(/\.nagma(\.json)?$/i, "") || "Untitled";
    const kind = kindOfDocument(doc);
    const meta = createFile(kind, { ...doc, name }, name);
    await openFile(meta.id);
    return { id: meta.id, name, kind, media: stored };
}

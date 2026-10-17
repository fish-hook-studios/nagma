import { useSyncExternalStore } from "react";
import { type PdfWorkbench, loadPdfEngine } from "../engines/pdf-engine";
import { collab } from "../engine/collab";
import { download } from "../engine/export";
import { setFileThumb } from "../engine/files";
import { imageBytes, storeImageNow } from "../engine/image-store";
import { editor } from "../engine/store";
import { type DocInfo, PDF_KEY, type Rect } from "./model";
import { type SearchHit, type TextLayer, buildTextLayer, findInLayer } from "./text";

// The Document workbench's state (per viewer, not part of the file): the open PDF in PdfCraft's
// engine, the tool, zoom, selection, search and the panels. Every edit runs in the engine, and
// a moment later the PDF it writes is stored as the file's content, so it autosaves, syncs and
// keeps versions like any other file.

export type DocTool =
    | "select"
    | "hand"
    | "note"
    | "highlight"
    | "underline"
    | "strikeout"
    | "draw"
    | "rect"
    | "oval"
    | "line"
    | "arrow"
    | "textbox"
    | "stamp"
    | "sign"
    | "fill"
    | "check"
    | "cross"
    | "edit"
    | "redact";

export type LeftTab = "pages" | "bookmarks" | "attachments" | "layers" | "comments" | "fields";

export interface ToolStyle {
    color: [number, number, number];
    opacity: number;
    width: number;
    fontSize: number;
}

// A signature ready to place: strokes drawn (0..1 of their box), a typed name, or a picture.
export type Signature =
    | { kind: "draw"; strokes: [number, number][][]; aspect: number }
    | { kind: "type"; text: string }
    | { kind: "image"; name: string; bytes: Uint8Array; aspect: number };

export type Dialog = null | "signature" | "protect" | "properties" | "split" | "insert" | "password";

export interface DocState {
    status: "idle" | "loading" | "ready" | "error" | "password";
    error: string | null;
    fileId: string | null;
    info: DocInfo | null;
    // Bumped on every change to the PDF: pictures and text are drawn again.
    version: number;
    tool: DocTool;
    zoom: number;
    fit: "width" | "page" | null;
    page: number;
    selected: { page: number; index: number } | null;
    pageSelection: number[];
    leftTab: LeftTab;
    leftOpen: boolean;
    view: "read" | "organize";
    searchOpen: boolean;
    query: string;
    hits: SearchHit[];
    hit: number;
    textSel: { page: number; from: number; to: number } | null;
    styles: Record<string, ToolStyle>;
    stamp: string;
    signature: Signature | null;
    dialog: Dialog;
    saving: "saved" | "saving" | "unsaved" | "failed";
    // Edit text and images: the image picked on a page.
    imageSel: { page: number; index: number } | null;
}

const DEFAULT_STYLES: Record<string, ToolStyle> = {
    highlight: { color: [1, 0.82, 0], opacity: 0.5, width: 1, fontSize: 12 },
    underline: { color: [0.15, 0.7, 0.45], opacity: 1, width: 1, fontSize: 12 },
    strikeout: { color: [0.93, 0.2, 0.25], opacity: 1, width: 1, fontSize: 12 },
    draw: { color: [0.2, 0.45, 0.95], opacity: 1, width: 2, fontSize: 12 },
    rect: { color: [0.93, 0.2, 0.25], opacity: 1, width: 2, fontSize: 12 },
    oval: { color: [0.93, 0.2, 0.25], opacity: 1, width: 2, fontSize: 12 },
    line: { color: [0.93, 0.2, 0.25], opacity: 1, width: 2, fontSize: 12 },
    arrow: { color: [0.93, 0.2, 0.25], opacity: 1, width: 2, fontSize: 12 },
    textbox: { color: [0, 0, 0], opacity: 1, width: 1, fontSize: 12 },
    note: { color: [1, 0.82, 0], opacity: 1, width: 1, fontSize: 12 },
    fill: { color: [0, 0, 0], opacity: 1, width: 1, fontSize: 12 },
};

let state: DocState = {
    status: "idle",
    error: null,
    fileId: null,
    info: null,
    version: 0,
    tool: "select",
    zoom: 1,
    fit: "width",
    page: 0,
    selected: null,
    pageSelection: [],
    leftTab: "pages",
    leftOpen: true,
    view: "read",
    searchOpen: false,
    query: "",
    hits: [],
    hit: 0,
    textSel: null,
    styles: DEFAULT_STYLES,
    stamp: "Approved",
    signature: null,
    dialog: null,
    saving: "saved",
    imageSel: null,
};
const listeners = new Set<() => void>();

export const docView = {
    get: () => state,
    set(patch: Partial<DocState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

// For checking the workbench from the browser console while developing (the editor is window.nagma).
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { nagmaDocView: docView });

export function useDoc<T>(selector: (s: DocState) => T): T {
    return useSyncExternalStore(docView.subscribe, () => selector(state));
}

export function styleFor(tool: string): ToolStyle {
    return state.styles[tool] ?? { color: [0, 0, 0], opacity: 1, width: 1, fontSize: 12 };
}

export function setToolStyle(tool: string, patch: Partial<ToolStyle>) {
    docView.set({ styles: { ...state.styles, [tool]: { ...styleFor(tool), ...patch } } });
}

export function setTool(tool: DocTool) {
    docView.set({ tool, selected: null, imageSel: null, ...(tool !== "select" && tool !== "highlight" && tool !== "underline" && tool !== "strikeout" && tool !== "redact" ? { textSel: null } : {}) });
}

export function me(): string {
    return collab.get().me.name || "Guest";
}

// ---- The open PDF ----

let wb: PdfWorkbench | null = null;
// The media reference of the PDF the workbench holds (what it opened or last saved).
let currentRef: string | null = null;
let password: string | null = null;
const textLayers = new Map<number, TextLayer>();

export function workbench(): PdfWorkbench | null {
    return wb;
}

function readInfo(): DocInfo | null {
    if (!wb) return null;
    try {
        return JSON.parse(wb.info()) as DocInfo;
    } catch {
        return null;
    }
}

// Opens the file's PDF in the engine, unless it already holds that version of it.
export async function syncWorkbench(force = false) {
    const s = editor.get();
    const ref = s.doc.images[PDF_KEY] ?? null;
    if (!force && wb && ref === currentRef && state.fileId === s.fileId) return;
    if (state.saving === "saving" && state.fileId === s.fileId && !force) return;
    const fileId = s.fileId;
    // Another document starts afresh: the Select tool (not the last file's Redact or Sign), its
    // first page (not the last file's page number), no dialog or search left open from that file.
    const switched = fileId !== state.fileId;
    docView.set({ status: "loading", error: null, fileId, ...(switched ? { tool: "select" as const, view: "read" as const, dialog: null, page: 0, searchOpen: false, query: "", hits: [] } : {}) });
    try {
        const engine = await loadPdfEngine();
        const bytes = ref ? await imageBytes(s.doc.images, PDF_KEY) : null;
        if (!bytes) throw new Error("This document's PDF is missing from this browser and the server.");
        if (editor.get().fileId !== fileId) return;
        let opened: PdfWorkbench;
        try {
            opened = new engine.PdfWorkbench(bytes, s.doc.name || "Document", password);
        } catch (error) {
            if (String(error instanceof Error ? error.message : error).toLowerCase().includes("password")) {
                docView.set({ status: "password", error: password ? "That password isn't right." : null });
                return;
            }
            throw error;
        }
        wb?.free();
        wb = opened;
        currentRef = ref;
        textLayers.clear();
        if (import.meta.env.DEV) Object.assign(window, { nagmaWorkbench: wb });
        const info = readInfo();
        docView.set({
            status: "ready",
            info,
            version: state.version + 1,
            page: Math.min(switched ? 0 : state.page, Math.max(0, (info?.pages.length ?? 1) - 1)),
            selected: null,
            textSel: null,
            imageSel: null,
            hits: [],
            pageSelection: [],
            saving: "saved",
        });
        if (fileId && !thumbDone.has(fileId)) void updateThumb(fileId);
    } catch (error) {
        docView.set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
}

export function unlock(pw: string) {
    password = pw;
    void syncWorkbench(true);
}

export function closeWorkbench() {
    window.clearTimeout(saveTimer);
    if (state.saving === "unsaved") void saveNow();
    wb?.free();
    wb = null;
    currentRef = null;
    password = null;
    textLayers.clear();
    docView.set({ status: "idle", info: null, fileId: null, selected: null, textSel: null, hits: [], query: "", searchOpen: false, view: "read", imageSel: null });
}

function changed(patch: Partial<DocState> = {}) {
    textLayers.clear();
    const info = readInfo();
    const pages = info?.pages.length ?? 0;
    docView.set({ info, version: state.version + 1, saving: "unsaved", page: Math.min(state.page, Math.max(0, pages - 1)), ...patch });
    if (state.searchOpen && state.query) runSearch(state.query);
    scheduleSave();
}

function fail(error: unknown) {
    editor.notify(error instanceof Error ? error.message : String(error));
}

function canEdit(): boolean {
    if (editor.get().readOnly) {
        editor.notify("This file is view only.");
        return false;
    }
    return Boolean(wb);
}

// Runs an engine edit (see engines/pdf-wasm/src/workbench.rs for the operations).
export function edit(op: Record<string, unknown>, patch: Partial<DocState> = {}): boolean {
    if (!canEdit() || !wb) return false;
    try {
        wb.apply(JSON.stringify(op));
    } catch (error) {
        fail(error);
        return false;
    }
    changed(patch);
    return true;
}

// Runs something against the engine directly (edits that carry file bytes). With `rethrow`, an
// engine error goes to the caller (to report with others) instead of a toast of its own.
export function run(action: (w: PdfWorkbench) => void, patch: Partial<DocState> = {}, rethrow = false): boolean {
    if (!canEdit() || !wb) return false;
    try {
        action(wb);
    } catch (error) {
        if (rethrow) throw error;
        fail(error);
        return false;
    }
    changed(patch);
    return true;
}

export function undo() {
    if (!canEdit() || !wb) return;
    try {
        const label = wb.undo();
        if (label) {
            changed({ selected: null });
            editor.notify(`Undid ${label.toLowerCase()}.`);
        }
    } catch (error) {
        fail(error);
    }
}

export function redo() {
    if (!canEdit() || !wb) return;
    try {
        const label = wb.redo();
        if (label) {
            changed({ selected: null });
            editor.notify(`Redid ${label.toLowerCase()}.`);
        }
    } catch (error) {
        fail(error);
    }
}

// ---- Saving ----

let saveTimer = 0;
function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveNow(), 500);
}

// Leaving the page (or switching away from it) saves what's pending straight away, and so does
// opening another file or closing this one's tab (the pending save was dropped: the workbench
// closed, or saved into the next file's check, after the switch).
editor.onLeave(() => {
    if (state.saving === "unsaved" && wb && state.fileId && state.fileId === editor.get().fileId) void saveNow();
});
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && state.saving === "unsaved") void saveNow();
    });
    window.addEventListener("pagehide", () => {
        if (state.saving === "unsaved") void saveNow();
    });
}

// Writes the PDF (an incremental update of the last save, or a full rewrite) and stores it as the
// file's content.
export async function saveNow(full = false): Promise<boolean> {
    window.clearTimeout(saveTimer);
    if (!wb || editor.get().readOnly) return false;
    const fileId = state.fileId;
    if (!fileId || editor.get().fileId !== fileId) return false;
    docView.set({ saving: "saving" });
    try {
        const { ref, stored } = storeImageNow(new Blob([wb.save(full) as BlobPart], { type: "application/pdf" }));
        currentRef = ref;
        // Into the document straight away: the file may stop being the open one while the PDF
        // is stored (the edit was lost when another file opened in that moment).
        editor.execute({ type: "image.set", id: PDF_KEY, data: ref });
        await stored;
        docView.set({ saving: state.saving === "saving" ? "saved" : state.saving, info: readInfo() });
        window.clearTimeout(thumbTimer);
        thumbTimer = window.setTimeout(() => void updateThumb(fileId), 400);
        return true;
    } catch (error) {
        docView.set({ saving: "failed" });
        fail(error);
        return false;
    }
}

// The file card on Home shows the first page.
let thumbTimer = 0;
const thumbDone = new Set<string>();
async function updateThumb(fileId: string) {
    // The workbench may hold another file by now; its page isn't this file's picture.
    if (!wb || state.fileId !== fileId || wb.pageCount() === 0) return;
    try {
        const info = state.info?.pages[0];
        if (!info) return;
        // The page whole, centred on the card (a portrait page would be cropped by the card).
        const [W, H, pad] = [640, 400, 28];
        const scale = Math.min((W - pad * 2) / info.width, (H - pad * 2) / info.height);
        const page = document.createElement("canvas");
        drawInto(0, scale, page);
        const card = document.createElement("canvas");
        card.width = W;
        card.height = H;
        const ctx = card.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#2A2A2E";
        ctx.fillRect(0, 0, W, H);
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 12;
        ctx.drawImage(page, (W - page.width) / 2, (H - page.height) / 2);
        setFileThumb(fileId, card.toDataURL("image/png"));
        thumbDone.add(fileId);
    } catch {
        // A picture is a nicety.
    }
}

// ---- Drawing and text ----

export function drawInto(page: number, scale: number, canvas: HTMLCanvasElement) {
    if (!wb) return;
    const out = wb.render(page, scale);
    try {
        canvas.width = out.width;
        canvas.height = out.height;
        const rgba = out.rgba;
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), out.width, out.height), 0, 0);
    } finally {
        out.free();
    }
}

export function textLayer(page: number): TextLayer | null {
    if (!wb) return null;
    const known = textLayers.get(page);
    if (known) return known;
    try {
        const layer = buildTextLayer(JSON.parse(wb.textLayer(page)) as { boxes: number[]; text: string[]; line: number[]; space: boolean[] });
        textLayers.set(page, layer);
        return layer;
    } catch {
        return null;
    }
}

export function runSearch(query: string) {
    const pages = state.info?.pages.length ?? 0;
    const hits: SearchHit[] = [];
    if (query.trim()) {
        for (let p = 0; p < pages; p++) {
            const layer = textLayer(p);
            if (layer) hits.push(...findInLayer(layer, p, query));
        }
    }
    docView.set({ query, hits, hit: Math.min(state.hit, Math.max(0, hits.length - 1)) });
}

// ---- Files out ----

export function pdfBytes(): Uint8Array | null {
    if (!wb) return null;
    try {
        return wb.save(false);
    } catch (error) {
        fail(error);
        return null;
    }
}

export function fileBase(): string {
    return (editor.get().doc.name || "Document").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Document";
}

export function downloadPdf() {
    const bytes = pdfBytes();
    if (bytes) download(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${fileBase()}.pdf`);
}

// A rectangle in view space as JSON for the engine.
export function rectJson(r: Rect): string {
    return JSON.stringify(r);
}

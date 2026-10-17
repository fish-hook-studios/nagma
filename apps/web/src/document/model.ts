import { storeImage } from "../engine/image-store";
import { createEmptyDocument } from "../engine/files";
import type { NagmaDocument } from "../engine/types";

// A Document file is a PDF. Its bytes live in the media store like an image (so they sync and
// keep with versions), under this key of the document's images; the workbench edits them through
// PdfCraft's engine and writes them back on save.

export const PDF_KEY = "pdf";
// The Document product's accent, a theme token (styles/globals.css, --doc-accent).
export const DOC_BLUE = "var(--doc-accent)";

export type Rect = [number, number, number, number];

export interface PageInfo {
    width: number;
    height: number;
    rotation: number;
    label: string;
}

export interface OutlineItem {
    title: string;
    page: number | null;
    open: boolean;
    children: OutlineItem[];
}

export interface CommentInfo {
    page: number;
    index: number;
    subtype: string;
    kind: string;
    author: string | null;
    contents: string | null;
    modified: string | null;
    name: string | null;
    inReplyTo: string | null;
    state: string | null;
    intent: string | null;
    locked: boolean;
    rect: Rect;
    quads: Rect[];
    color: [number, number, number] | null;
    opacity: number;
    width: number | null;
    subject: string | null;
    restylable: boolean;
}

export interface FieldInfo {
    name: string;
    kind: "text" | "checkbox" | "radio" | "button" | "combo" | "list" | "signature";
    value: string[];
    options: [string, string][];
    readOnly: boolean;
    required: boolean;
    multiline: boolean;
    multi: boolean;
    maxLen: number | null;
    tooltip: string | null;
    widgets: { page: number; rect: Rect; onState: string | null; state: string | null; hidden: boolean }[];
}

export interface DocInfo {
    pages: PageInfo[];
    title: string | null;
    author: string | null;
    subject: string | null;
    keywords: string | null;
    creator: string | null;
    producer: string | null;
    pdfVersion: string;
    fileSize: number;
    encrypted: boolean;
    tagged: boolean;
    outline: OutlineItem[];
    attachments: { name: string; description: string | null; size: number | null }[];
    layers: { name: string; visible: boolean }[];
    fonts: string[];
    comments: CommentInfo[];
    fields: FieldInfo[];
    security: { method: string; owner: boolean; pending: boolean } | null;
    editable: boolean;
    readOnlyReason: string | null;
    signed: boolean;
    redactionMarks: number;
    allows: { print: boolean; modify: boolean; assemble: boolean; annotate: boolean; fill: boolean; security: boolean };
    undo: string | null;
    redo: string | null;
    dirty: boolean;
    warnings: string[];
}

// Standard page sizes in points.
export const PAGE_SIZES = {
    a4: { label: "A4", width: 595.28, height: 841.89 },
    letter: { label: "Letter", width: 612, height: 792 },
    legal: { label: "Legal", width: 612, height: 1008 },
    a5: { label: "A5", width: 419.53, height: 595.28 },
} as const;
export type PageSizeId = keyof typeof PAGE_SIZES;

export function isPdfDocument(doc: NagmaDocument | null | undefined): boolean {
    return Boolean(doc?.pdf);
}

// A Document file holding these PDF bytes.
export async function createPdfDocument(name: string, bytes: Uint8Array): Promise<NagmaDocument> {
    const ref = await storeImage(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const base = createEmptyDocument(name);
    return { ...base, images: { [PDF_KEY]: ref }, pdf: true };
}

// The page size's name when it is a standard one, else its size in millimetres.
export function pageSizeName(p: { width: number; height: number }): string {
    const [w, h] = [Math.min(p.width, p.height), Math.max(p.width, p.height)];
    for (const size of Object.values(PAGE_SIZES)) {
        if (Math.abs(size.width - w) < 2 && Math.abs(size.height - h) < 2) return `${size.label}${p.width > p.height ? " landscape" : ""}`;
    }
    const mm = (pt: number) => Math.round((pt / 72) * 25.4);
    return `${mm(p.width)} × ${mm(p.height)} mm`;
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// "D:20261014093000+05'30'" → a readable date.
export function pdfDate(value: string | null | undefined): string {
    const m = value?.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
    // The engine reads most dates out already ("2026-10-14 09:30").
    if (!m) return value ?? "";
    const date = new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0));
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const COMMENT_LABELS: Record<string, string> = {
    Text: "Note",
    Highlight: "Highlight",
    Underline: "Underline",
    StrikeOut: "Strikethrough",
    Squiggly: "Squiggly",
    Square: "Rectangle",
    Circle: "Ellipse",
    Line: "Line",
    Ink: "Drawing",
    FreeText: "Text box",
    Stamp: "Stamp",
    Redact: "Redaction",
    Caret: "Insert text",
    Polygon: "Polygon",
    PolyLine: "Polyline",
    FileAttachment: "Attachment",
};

export function commentLabel(c: CommentInfo): string {
    if (c.subject && (c.subtype === "Stamp" || (c.subtype === "Ink" && c.subject === "Signature"))) return c.subject;
    if (c.subtype === "Line" && c.kind.toLowerCase().includes("arrow")) return "Arrow";
    return COMMENT_LABELS[c.subtype] ?? c.subtype;
}

// Stamps from the engine's palette (names as the engine knows them) and the words they show.
export const STAMPS: { id: string; label: string; group: "Standard" | "Sign here" | "Dynamic" }[] = [
    { id: "Approved", label: "Approved", group: "Standard" },
    { id: "Completed", label: "Completed", group: "Standard" },
    { id: "Confidential", label: "Confidential", group: "Standard" },
    { id: "Draft", label: "Draft", group: "Standard" },
    { id: "Final", label: "Final", group: "Standard" },
    { id: "ForComment", label: "For comment", group: "Standard" },
    { id: "InformationOnly", label: "Information only", group: "Standard" },
    { id: "NotApproved", label: "Not approved", group: "Standard" },
    { id: "Void", label: "Void", group: "Standard" },
    { id: "SignHere", label: "Sign here", group: "Sign here" },
    { id: "InitialHere", label: "Initial here", group: "Sign here" },
    { id: "Witness", label: "Witness", group: "Sign here" },
    { id: "Accepted", label: "Accepted", group: "Sign here" },
    { id: "Rejected", label: "Rejected", group: "Sign here" },
    { id: "DynApproved", label: "Approved, with name and time", group: "Dynamic" },
    { id: "DynReviewed", label: "Reviewed, with name and time", group: "Dynamic" },
    { id: "DynReceived", label: "Received, with name and time", group: "Dynamic" },
];

export const SWATCHES: [number, number, number][] = [
    [1, 0.82, 0],
    [0.98, 0.45, 0.1],
    [0.93, 0.2, 0.25],
    [0.85, 0.3, 0.75],
    [0.2, 0.45, 0.95],
    [0.15, 0.7, 0.45],
    [0, 0, 0],
    [1, 1, 1],
];

export function toHex(c: [number, number, number] | null | undefined): string {
    const v = c ?? [0, 0, 0];
    return `#${v.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(hex: string): [number, number, number] {
    const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1] as string, 16) / 255, parseInt(m[2] as string, 16) / 255, parseInt(m[3] as string, 16) / 255];
}

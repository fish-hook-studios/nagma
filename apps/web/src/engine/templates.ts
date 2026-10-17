import { createEmptyDocument, createFile, type FileKind, type FileMeta } from "./files";
import { createInvestDocument } from "./invest-template";
import { createSampleDocument } from "./sample";
import type { NagmaDocument } from "./types";

// Templates on Home's "Get started with a template" strip. Each makes a new file.
export interface Template {
    id: string;
    name: string;
    kind: FileKind;
    tags: ("for-you" | "mobile" | "docs" | "video" | "web")[];
    // A preview for the card (CSS background), and the document it starts from.
    preview: string;
    make: () => NagmaDocument;
}

const palette = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;

export const TEMPLATES: Template[] = [
    { id: "blank", name: "Blank design", kind: "design", tags: ["for-you", "web", "mobile"], preview: palette("#2A2A2E", "#3A3A42"), make: () => createEmptyDocument("Untitled") },
    { id: "invest", name: "Vesta investing app (10 screens)", kind: "design", tags: ["for-you", "mobile"], preview: palette("#0B0F19", "#5B6CFF"), make: () => createInvestDocument() },
    { id: "sample", name: "Sample app", kind: "design", tags: ["for-you", "mobile"], preview: palette("#6D4AFF", "#FF7A59"), make: () => createSampleDocument() },
    { id: "video", name: "Video", kind: "video", tags: ["for-you", "video"], preview: palette("#8B2E2E", "#E06A4F"), make: () => ({ ...createEmptyDocument("Untitled video"), sequence: { width: 1920, height: 1080, fps: 30, clips: [] } }) },
];

export const TEMPLATE_TABS: { id: Template["tags"][number]; label: string }[] = [
    { id: "for-you", label: "For you" },
    { id: "mobile", label: "Mobile" },
    { id: "web", label: "Web" },
    { id: "docs", label: "Docs" },
    { id: "video", label: "Video" },
];

export function fileFromTemplate(t: Template): FileMeta {
    const doc = t.make();
    return createFile(t.kind, doc, doc.name || t.name);
}

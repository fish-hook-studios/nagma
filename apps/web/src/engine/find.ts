// Find and replace (⌘F): search layer names and text across this page or every page,
// optionally only one kind of layer; replace works on text content only.
import { zoomToSelection } from "./camera";
import { implicitlyNamed } from "./matching";
import { editor } from "./store";
import type { Command, NagmaDocument, SceneNode } from "./types";

export type FindKind = "all" | "text" | "frame" | "component" | "instance" | "group" | "shape" | "image" | "section";

export const FIND_KINDS: { id: FindKind; label: string }[] = [
    { id: "all", label: "All layers" },
    { id: "text", label: "Text" },
    { id: "frame", label: "Frames" },
    { id: "section", label: "Sections" },
    { id: "component", label: "Components" },
    { id: "instance", label: "Instances" },
    { id: "group", label: "Groups" },
    { id: "shape", label: "Shapes and vectors" },
    { id: "image", label: "Images" },
];

function kindOf(node: SceneNode): FindKind[] {
    const kinds: FindKind[] = ["all"];
    if (node.type === "text") kinds.push("text");
    if (node.isSection) kinds.push("section");
    else if (node.type === "frame") kinds.push("frame");
    if (node.type === "component" || node.type === "componentSet") kinds.push("component");
    if (node.type === "instance") kinds.push("instance");
    if (node.type === "group" || node.type === "boolean") kinds.push("group");
    if (node.type === "rect" || node.type === "ellipse" || node.type === "vector" || node.type === "boolean") kinds.push("shape");
    if (node.fills.some((p) => p.type === "image")) kinds.push("image");
    return kinds;
}

export interface FindResult {
    id: string;
    pageId: string;
    // Where the query matched: the layer name, its text, or both.
    inName: boolean;
    inText: boolean;
}

// Layers matching the query, in Layers panel order (pages in order, front-most first).
export function findLayers(doc: NagmaDocument, query: string, options: { pageId: string | null; kind: FindKind }): FindResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: FindResult[] = [];
    const pages = options.pageId ? [options.pageId] : doc.roots;
    for (const pageId of pages) {
        const visit = (ids: string[]) => {
            for (let i = ids.length - 1; i >= 0; i--) {
                const node = doc.nodes[ids[i] ?? ""];
                if (!node) continue;
                if (kindOf(node).includes(options.kind)) {
                    const inName = node.name.toLowerCase().includes(q);
                    const inText = node.type === "text" && (node.text ?? "").toLowerCase().includes(q);
                    if (inName || inText) out.push({ id: node.id, pageId, inName, inText });
                }
                visit(node.children);
            }
        };
        visit(doc.nodes[pageId]?.children ?? []);
    }
    return out;
}

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replaces the query in the text of the given text layers (case-insensitive), as one undo step.
// Text layers still named after their content are renamed to match.
export function replaceText(ids: string[], query: string, replacement: string): number {
    const q = query.trim();
    if (!q) return 0;
    const { doc } = editor.get();
    const pattern = new RegExp(escape(q), "gi");
    const commands: Command[] = [];
    for (const id of ids) {
        const node = doc.nodes[id];
        if (!node || node.type !== "text" || !node.text) continue;
        const text = node.text.replace(pattern, () => replacement);
        if (text === node.text) continue;
        const rename = implicitlyNamed(node) ? { name: text.split("\n")[0]?.slice(0, 40) || "Text" } : {};
        commands.push({ type: "node.update", id, patch: { text, ...rename } });
    }
    if (!commands.length) return 0;
    editor.execute({ type: "batch", commands });
    return commands.length;
}

// Shows a result: its page, selected, in view. ⇧ or ⌘ adds it to the selection instead.
export function revealResult(result: FindResult, add = false) {
    const s = editor.get();
    if (result.pageId !== s.pageId) editor.setPage(result.pageId);
    const selection = editor.get().selection;
    editor.set({ selection: add ? (selection.includes(result.id) ? selection.filter((id) => id !== result.id) : [...selection, result.id]) : [result.id] });
    zoomToSelection();
}

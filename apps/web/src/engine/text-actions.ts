import { editor } from "./store";
import { openLinkEditor } from "./text-link";
import { MIXED, paragraphStyle } from "./rich-text";
import { applyCharStyle, selectedParagraphs, sharedTextValue, updateParagraphs } from "./text-session";
import type { Command, SceneNode, TextCase } from "./types";

// Text shortcuts on selected text layers: style toggles, alignment and stepped adjustments.

function textNodes(): { nodes: SceneNode[] } {
    const { doc, selection } = editor.get();
    return { nodes: selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && n.type === "text") };
}

function updateText(fn: (node: SceneNode) => Partial<SceneNode> | null) {
    const { nodes } = textNodes();
    const commands: Command[] = nodes.flatMap((node) => {
        const patch = fn(node);
        return patch ? [{ type: "node.update" as const, id: node.id, patch }] : [];
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function hasTextSelection() {
    return textNodes().nodes.length > 0;
}

// ⌘B, ⌘I, ⌘U and ⇧⌘X: on the selected range while editing, else on whole layers. A layer with a
// text style keeps it; the change overrides just those characters.
export function toggleBold() {
    const { nodes } = textNodes();
    const weight = sharedTextValue(nodes, "fontWeight");
    const allBold = weight !== MIXED && weight >= 600;
    applyCharStyle(nodes, { fontWeight: allBold ? 400 : 700 }, { keepStyle: true });
}

export function toggleItalic() {
    const { nodes } = textNodes();
    const italic = sharedTextValue(nodes, "italic");
    applyCharStyle(nodes, { italic: italic !== true }, { keepStyle: true });
}

export function toggleDecoration(kind: "underline" | "strikethrough") {
    const { nodes } = textNodes();
    const current = sharedTextValue(nodes, "decoration");
    applyCharStyle(nodes, { decoration: current === kind ? "none" : kind }, { keepStyle: true });
}

export function setTextAlign(align: "left" | "center" | "right" | "justify") {
    updateText(() => ({ textAlign: align }));
}

// Text › Alignment › Text align top / middle / bottom.
export function setTextAlignV(align: "top" | "middle" | "bottom") {
    updateText(() => ({ textAlignV: align }));
}

// Text › Case: the case as a style on the selected characters (the text itself is kept), and
// Original case to take it off.
export function setTextCase(textCase: TextCase) {
    applyCharStyle(textNodes().nodes, { textCase }, { keepStyle: true });
}

// Font size steps by 1 (⇧⌘< >), weight by 100 (⌥⌘< >), letter spacing by 1% (⌥< >), line height by 5% (⌥⇧< >).
function step<K extends "fontSize" | "fontWeight" | "letterSpacing" | "lineHeight">(key: K, next: (v: number) => number, fallback: number) {
    const { nodes } = textNodes();
    for (const node of nodes) {
        const v = sharedTextValue([node], key);
        const current = v === MIXED || v === null ? fallback : (v as number);
        applyCharStyle([node], { [key]: next(current) }, { keepStyle: true });
    }
    if (nodes.length > 1) editor.mergeLast();
}

export function stepFontSize(direction: 1 | -1) {
    step("fontSize", (v) => Math.max(1, v + direction), 16);
}

export function stepFontWeight(direction: 1 | -1) {
    step("fontWeight", (v) => Math.min(900, Math.max(100, v + direction * 100)), 400);
}

export function stepLetterSpacing(direction: 1 | -1) {
    step("letterSpacing", (v) => Math.round((v + direction) * 100) / 100, 0);
}

export function stepLineHeight(direction: 1 | -1) {
    step("lineHeight", (v) => Math.max(0.5, Math.round((v + direction * 0.05) * 100) / 100), 1.2);
}

export function setCase(kind: "upper" | "lower" | "title") {
    updateText((n) => {
        const text = n.text ?? "";
        const next = kind === "upper" ? text.toUpperCase() : kind === "lower" ? text.toLowerCase() : text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
        return next === text ? null : { text: next };
    });
}

// ⇧⌘8 and ⇧⌘7: the selected paragraphs (every paragraph of a layer not being edited) become list
// items, or stop being ones when they all already are.
export function toggleList(kind: "bullet" | "number") {
    const { nodes } = textNodes();
    if (!nodes.length) return;
    const editing = editor.get().editingTextId;
    const all = nodes.every((n) => {
        const [a, b] = selectedParagraphs(n);
        for (let i = a; i <= b; i++) if (paragraphStyle(n, i).list !== kind) return false;
        return true;
    });
    const commands = updateParagraphs(nodes, (p) => {
        if (all && p.list === kind) return { list: null, level: Math.max(0, (p.level ?? 1) - 1) };
        return { list: kind, level: Math.max(1, p.level ?? 1) };
    });
    // A layer edited as a whole keeps the simple layer-wide setting too.
    for (const n of nodes) if (n.id !== editing) commands.push({ type: "node.update", id: n.id, patch: { list: all ? null : kind } });
    editor.execute({ type: "batch", commands });
}

// Tab, ⇧Tab, ⌘] and ⌘[ in list items: one indentation level in or out (the reference allows five).
export function indentParagraphs(direction: 1 | -1) {
    const { nodes } = textNodes();
    if (!nodes.length) return;
    const commands = updateParagraphs(nodes, (p) => {
        const min = p.list ? 1 : 0;
        return { list: p.list ?? null, level: Math.max(min, Math.min(5, (p.level ?? 0) + direction)) };
    });
    editor.execute({ type: "batch", commands });
}

export function setDirection(direction: "ltr" | "rtl") {
    updateText(() => ({ direction }));
}

// ⇧⌘U: a link on the selected text (opens the link field in Typography).
export function createLink() {
    if (textNodes().nodes.length) openLinkEditor();
}

import { hasCopiedLayers } from "../engine/layer-clipboard";
import { useEffect } from "react";
import { leaveVectorEdit, viewCenter } from "../engine/actions";
import { importSvg, looksLikeSvg } from "../engine/svg-import";
import { flattenSelection } from "../engine/flatten";
import { editor } from "../engine/store";
import { setVectorTool } from "../engine/vector-actions";
import { vectorUi } from "../engine/vector-ui";
import type { VectorTool } from "../canvas/vector-edit";

// Keys for flatten, crop, place, export and the vector bar's newer tools. Runs before the general
// shortcuts (capture phase) and stops the event when it handles it.
export type KeyHandler = (event: KeyboardEvent) => boolean;

const handlers: KeyHandler[] = [];

export function addKeyHandler(handler: KeyHandler) {
    handlers.push(handler);
}

function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

// ⌥⇧F flattens (in point editing it leaves the edit first).
addKeyHandler((event) => {
    if (!(event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey && event.code === "KeyF")) return false;
    const s = editor.get();
    if (!s.selection.length) return false;
    if (s.editingVectorId) leaveVectorEdit();
    flattenSelection();
    return true;
});

// Point editing: Q lasso, X cut, ⇧E erase, ⇧W variable width, M shape builder.
addKeyHandler((event) => {
    const s = editor.get();
    if (!s.editingVectorId || event.metaKey || event.ctrlKey || event.altKey) return false;
    const tools: Record<string, VectorTool> = event.shiftKey ? { KeyE: "erase", KeyW: "width", KeyB: "paint" } : { KeyQ: "lasso", KeyX: "cut", KeyM: "builder" };
    const tool = tools[event.code];
    if (!tool) return false;
    if (s.tool === "pen") editor.set({ tool: "move" });
    setVectorTool(tool);
    return true;
});

// ⇧⌘E opens the Export dialog.
addKeyHandler((event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.code !== "KeyE") return false;
    vectorUi.set({ exportOpen: true });
    return true;
});

export function useVectorShortcuts() {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (typing(event.target)) return;
            const s = editor.get();
            if (s.editingTextId || s.presentingId || s.readOnly) return;
            for (const handler of handlers) {
                if (handler(event)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }
            }
        };
        // Pasted SVG markup becomes layers (before the general paste handler sees it).
        const onPaste = (event: ClipboardEvent) => {
            if (typing(event.target)) return;
            const s = editor.get();
            if (s.editingTextId || s.presentingId || s.readOnly || s.homeOpen) return;
            // Layers copied in another design tool are the general handler's (they win over markup).
            if (hasCopiedLayers(event.clipboardData?.getData("text/html") ?? "")) return;
            const text = event.clipboardData?.getData("image/svg+xml") || event.clipboardData?.getData("text/plain") || "";
            if (!looksLikeSvg(text)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!importSvg(text, viewCenter(), "SVG")) editor.notify("That SVG couldn't be read.");
        };
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("paste", onPaste, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("paste", onPaste, true);
        };
    }, []);
}

import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { editor } from "../engine/store";
import { type AnyStyle, type StyleKind, layerEffects, textStyleFrom } from "../engine/styles";
import type { ColorStyle, EffectStyle, NagmaDocument, Paint, SceneNode, TextStyle } from "../engine/types";

// The style editor window: editing a style, or creating one (optionally applied to layers).
export interface StyleEditing {
    kind: StyleKind;
    // An existing style's id, or a draft for "Create style".
    id: string | null;
    draft?: AnyStyle;
    applyTo?: string[];
    // Colour styles created from a stroke apply to strokes.
    target?: "fills" | "strokes";
}

let editing: StyleEditing | null = null;
const listeners = new Set<() => void>();

export function editStyle(next: StyleEditing | null) {
    editing = next;
    for (const l of listeners) l();
}

export function useStyleEditing(): StyleEditing | null {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => editing,
    );
}

export async function copyStyleLink(id: string) {
    const url = new URL(location.href);
    url.hash = `style=${encodeURIComponent(id)}`;
    try {
        await navigator.clipboard.writeText(url.toString());
        editor.notify("Link to style copied.");
    } catch {
        editor.notify("Couldn't copy the link.");
    }
}

// A new style's starting values, from the selection.
export function draftFrom(kind: StyleKind, node: SceneNode, target: "fills" | "strokes", doc: NagmaDocument): AnyStyle | null {
    if (kind === "color") {
        const paints = target === "fills" ? node.fills : node.strokes;
        const paint = paints[paints.length - 1] ?? ({ type: "solid", color: "#D9D9D9", opacity: 1, visible: true, blend: "normal" } as Paint);
        const varId = node.boundVariables?.[target === "fills" ? `fill:${paints.length - 1}` : `stroke:${paints.length - 1}`] ?? node.boundVariables?.[target === "fills" ? "fill" : "stroke"];
        return { id: nanoid(8), name: `Colour ${(doc.styles?.colors.length ?? 0) + 1}`, paint, ...(varId ? { variableId: varId } : {}) } as ColorStyle;
    }
    if (kind === "text") return textStyleFrom(node, `${node.fontFamily ?? "Inter"} ${node.fontSize ?? 16}`);
    return { id: nanoid(8), name: `Effect ${(doc.styles?.effects?.length ?? 0) + 1}`, shadow: null, blur: 0, effects: layerEffects(node) } as EffectStyle;
}

// Where a new style goes when it's made from nothing (the Styles section's "+").
export function blankStyle(kind: StyleKind): AnyStyle {
    if (kind === "color") return { id: nanoid(8), name: "Colour", paint: { type: "solid", color: "#D9D9D9", opacity: 1, visible: true, blend: "normal" } } as ColorStyle;
    if (kind === "text") return { id: nanoid(8), name: "Text", fontFamily: "Inter", fontSize: 16, fontWeight: 400, italic: false, lineHeight: null, letterSpacing: 0 } as TextStyle;
    return { id: nanoid(8), name: "Effect", shadow: null, blur: 0, effects: [{ type: "drop-shadow", visible: true, x: 0, y: 4, blur: 12, spread: 0, color: "#000000", opacity: 0.25 }] } as EffectStyle;
}

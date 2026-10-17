import { MIXED } from "./rich-text";
import { sessionRange, styleCommands, textSession, textValue } from "./text-session";
import type { Command, Paint, SceneNode } from "./types";

// Fills of text follow the text's ranges: the Fill section shows and edits the selected range's
// fill while editing, and a whole layer's fills clear the ranges' own.

export function fillsOf(node: SceneNode): Paint[] | null {
    if (node.type !== "text" || (!node.spans?.length && !sessionRange(node.id))) return node.fills;
    const v = textValue(node, "fills");
    return v === MIXED ? null : v;
}

export function fillCommands(node: SceneNode, fills: Paint[]): Command[] {
    if (node.type !== "text") return [{ type: "node.update", id: node.id, patch: { fills } }];
    const range = sessionRange(node.id);
    // A bare caret: the next characters typed take the fill.
    if (range && range.start === range.end) {
        const s = textSession.get();
        if (s) textSession.patch({ typing: { ...(s.typing ?? {}), fills } });
        return [];
    }
    return styleCommands([node], { fills });
}

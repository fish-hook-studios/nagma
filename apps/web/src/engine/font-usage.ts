import { fontStatus } from "./fonts";
import { styledRuns } from "./rich-text";
import type { Command, NagmaDocument, SceneNode } from "./types";

// Which font families text layers use, which of them are missing, and replacing them.

export function familiesOf(node: SceneNode): string[] {
    if (node.type !== "text") return [];
    return [...new Set(styledRuns(node).map((r) => r.style.fontFamily))];
}

// Missing families in the document with how many layers use each.
export function missingFonts(doc: NagmaDocument): { family: string; layers: number }[] {
    const counts = new Map<string, number>();
    for (const node of Object.values(doc.nodes)) {
        for (const family of familiesOf(node)) if (fontStatus(family) === "missing") counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    return [...counts.entries()].map(([family, layers]) => ({ family, layers })).sort((a, b) => b.layers - a.layers);
}

export function replaceFonts(doc: NagmaDocument, map: Record<string, string>): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "text") continue;
        const patch: Partial<SceneNode> = {};
        const base = node.fontFamily ?? "Inter";
        if (map[base]) patch.fontFamily = map[base];
        if (node.spans?.some((s) => s.fontFamily && map[s.fontFamily])) patch.spans = node.spans.map((s) => (s.fontFamily && map[s.fontFamily] ? { ...s, fontFamily: map[s.fontFamily] } : s));
        if (Object.keys(patch).length) commands.push({ type: "node.update", id: node.id, patch });
    }
    return commands;
}


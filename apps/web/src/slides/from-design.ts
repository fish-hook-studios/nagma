import { applyCommand } from "../engine/commands";
import { createFile, openFile } from "../engine/files";
import { cloneSubtree } from "../engine/nodes";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { SLIDE_H, SLIDE_W, addSlideCommands, createSlidesDocument, deckPage, slideIds, tidyCommands } from "./model";

// Design file > Copy frames to slides: top-level frames shaped like slides (4:3 to 16:9) become
// the slides of a new deck, in reading order, scaled to fit 1920 × 1080. Instances come over as
// plain frames (the deck doesn't have the components), and prototype links are left behind.

function slideShaped(node: SceneNode): boolean {
    const ratio = node.w / Math.max(1, node.h);
    return ratio >= 4 / 3 - 0.02 && ratio <= 16 / 9 + 0.02;
}

export function slideFrames(doc: NagmaDocument, ids: string[]): SceneNode[] {
    return ids
        .map((id) => doc.nodes[id])
        .filter((n): n is SceneNode => Boolean(n && (n.type === "frame" || n.type === "component" || n.type === "instance") && doc.nodes[n.parentId ?? ""]?.type === "page" && slideShaped(n)))
        .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
}

// The copy of a layer on its slide: moved and scaled, and detached from any component.
function placed(n: SceneNode, frame: SceneNode, k: number, ox: number, oy: number): SceneNode {
    const s = (v: number | undefined) => (v === undefined ? v : v * k);
    const out: SceneNode = {
        ...n,
        children: [],
        x: ox + (n.x - frame.x) * k,
        y: oy + (n.y - frame.y) * k,
        w: n.w * k,
        h: n.h * k,
        interactions: undefined,
        flowStart: undefined,
    };
    if (k !== 1) {
        out.fontSize = s(n.fontSize);
        out.strokeWidth = n.strokeWidth * k;
        out.radius = n.radius * k;
        out.paragraphSpacing = s(n.paragraphSpacing);
        out.spans = n.spans?.map((sp) => ({ ...sp, fontSize: s(sp.fontSize) }));
        if (n.layout) out.layout = { ...n.layout, gap: n.layout.gap * k, padding: n.layout.padding.map((p) => p * k) as [number, number, number, number] };
    }
    if (out.type === "instance" || out.type === "component") {
        out.type = "frame";
        out.componentId = undefined;
    }
    return out;
}

export async function copyFramesToSlides() {
    const s = editor.get();
    if (s.doc.slides) return;
    const frames = slideFrames(s.doc, s.selection);
    if (!frames.length) {
        editor.notify("Select top-level frames shaped like slides (from 4:3 to 16:9).");
        return;
    }
    const name = s.doc.name || "Untitled";
    let doc = createSlidesDocument(name);
    doc = applyCommand(doc, { type: "node.delete", ids: slideIds(doc) });
    const page = deckPage(doc);
    if (page?.deck?.kind === "deck") doc = applyCommand(doc, { type: "node.update", id: page.id, patch: { deck: { ...page.deck, picker: false } } });
    doc = { ...doc, images: { ...s.doc.images } };
    for (const frame of frames) {
        const made = addSlideCommands(doc, "blank");
        doc = applyCommand(doc, { type: "batch", commands: made.commands });
        const slide = doc.nodes[made.id] as SceneNode;
        const k = Math.min(SLIDE_W / frame.w, SLIDE_H / frame.h);
        const ox = slide.x + (SLIDE_W - frame.w * k) / 2;
        const oy = slide.y + (SLIDE_H - frame.h * k) / 2;
        const solid = frame.fills.find((p) => p.visible && p.type === "solid");
        const info = slide.deck?.kind === "slide" ? slide.deck : null;
        const commands: Command[] = [
            {
                type: "node.update",
                id: slide.id,
                patch: { name: frame.name, ...(frame.fills.length ? { fills: frame.fills } : {}), ...(info ? { deck: { ...info, background: solid?.type === "solid" ? solid.color : frame.fills.length ? "#FFFFFF" : null } } : {}) },
            },
        ];
        for (const child of frame.children) {
            // Parents come before their children, each under the parent the copy gave it.
            for (const n of cloneSubtree(s.doc, child, 0, slide.id)) commands.push({ type: "node.create", node: placed(n, frame, k, ox, oy) });
        }
        doc = applyCommand(doc, { type: "batch", commands });
    }
    doc = applyCommand(doc, { type: "batch", commands: tidyCommands(doc) });
    const meta = createFile("slides", doc, name);
    await openFile(meta.id);
    editor.notify(`Copied ${frames.length} frame${frames.length === 1 ? "" : "s"} to a new slides file.`);
}

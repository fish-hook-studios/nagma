import { applyCommand } from "./commands";
import { makeNode } from "./nodes";
import { solid } from "./paint";
import type { NagmaDocument, NodeType, Rect, SceneNode } from "./types";

// The starter file a new browser sees: one phone screen, so the canvas is never blank.
export function createSampleDocument(): NagmaDocument {
    let doc: NagmaDocument = { name: "Untitled", nodes: {}, roots: [], images: {} };

    const add = (type: NodeType, rect: Rect, parentId: string | null, overrides: Partial<SceneNode>) => {
        const node = makeNode(doc, type, rect, parentId, overrides);
        doc = applyCommand(doc, { type: "node.create", node });
        return node.id;
    };

    const page = add("page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1" });
    const home = add("frame", { x: 0, y: 0, w: 390, h: 844 }, page, { name: "Home", fills: [solid("#FFFFFF")] });
    add("rect", { x: 20, y: 72, w: 350, h: 220 }, home, { name: "Hero", fills: [solid("#6D4AFF")], radius: 24 });
    add("ellipse", { x: 250, y: 100, w: 96, h: 96 }, home, { name: "Sun", fills: [solid("#FFC94D")] });
    add("text", { x: 44, y: 212, w: 260, h: 34 }, home, {
        name: "Title",
        text: "Hello, Nagma",
        fontSize: 28,
        fontWeight: 700,
        fills: [solid("#FFFFFF")],
    });
    add("text", { x: 20, y: 316, w: 350, h: 22 }, home, {
        name: "Body",
        text: "Design, animate and edit together.",
        fontSize: 16,
        fills: [solid("#475467")],
    });
    add("rect", { x: 20, y: 764, w: 350, h: 52 }, home, { name: "Button", fills: [solid("#111111")], radius: 14 });
    add("text", { x: 150, y: 779, w: 100, h: 22 }, home, {
        name: "Button label",
        text: "Get started",
        fontSize: 16,
        fontWeight: 600,
        fills: [solid("#FFFFFF")],
    });

    return doc;
}

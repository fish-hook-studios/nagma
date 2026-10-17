import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

await import("../app");
const { editor } = await import("../engine/store");
const { LayersPanel } = await import("./layers-panel");
const { designDoc } = await import("../test/design-doc");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom doesn't lay out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = () => undefined;

describe("the Layers list works from the keyboard", () => {
    let root: Root;
    let host: HTMLDivElement;
    let ids: Record<string, string>;
    beforeAll(async () => {
        const { doc, byName } = designDoc([
            { type: "rect", name: "Back" },
            { type: "frame", name: "Card", x: 200, w: 300, h: 300 },
            { type: "rect", name: "Inside", x: 210, parent: "Card" },
            { type: "rect", name: "Front", x: 600 },
        ]);
        ids = Object.fromEntries(Object.values(byName).map((n) => [n.name, n.id]));
        editor.loadDocument(doc, null);
        editor.set({ selection: [] });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(LayersPanel)));
    });
    afterAll(() => act(() => root.unmount()));

    const rows = () => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const focused = () => (document.activeElement as HTMLElement).getAttribute("aria-label");
    const press = async (key: string, shiftKey = false) => {
        await act(async () => {
            document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
        });
    };

    it("is a tree with one row to Tab to", () => {
        expect(host.querySelector('[role="tree"]')).not.toBeNull();
        // Frames start closed.
        expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Front", "Card", "Back"]);
        expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    });

    it("arrows move and select, ⇧ extends, ← and → close, open and walk the tree", async () => {
        rows()[0]!.focus();
        await press("ArrowDown");
        expect(focused()).toBe("Card");
        expect(editor.get().selection).toEqual([ids.Card]);
        await press("ArrowRight");
        expect(rows()).toHaveLength(4);
        await press("ArrowRight");
        expect(focused()).toBe("Inside");
        await press("ArrowLeft");
        expect(focused()).toBe("Card");
        await press("ArrowLeft");
        expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Front", "Card", "Back"]);
        await press("ArrowRight");
        expect(rows()).toHaveLength(4);
        await press("End");
        expect(focused()).toBe("Back");
        await press("ArrowUp", true);
        expect(editor.get().selection.sort()).toEqual([ids.Back!, ids.Inside!].sort());
    });

    it("the arrows don't nudge the selected layer while the tree has focus", async () => {
        const x = editor.get().doc.nodes[ids.Inside!]!.x;
        rows()[2]!.focus();
        await press("ArrowDown");
        expect(editor.get().doc.nodes[ids.Inside!]!.x).toBe(x);
    });

    it("Return renames", async () => {
        rows()[0]!.focus();
        await press("Enter");
        expect((document.activeElement as HTMLInputElement).getAttribute("aria-label")).toBe("Layer name");
    });
});

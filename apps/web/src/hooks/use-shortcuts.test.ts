import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The hook only registers window listeners in an effect: run the effect straight away.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useEffect: (effect: () => void) => void effect() }));

// A Mac (the shortcuts read ⌘ as the command key there); set before the modules load.
Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
// Load the editor the way main.tsx does (the app first), so modules meet in their usual order.
await import("../app");
const { editor } = await import("../engine/store");
const { useShortcuts } = await import("./use-shortcuts");
const { designDoc } = await import("../test/design-doc");

// A key press as a Mac keyboard sends it: ⌥ and ⇧ change `key` ("÷", "?", "å"), `code` stays.
function press(code: string, key: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) {
    const init = { code, key, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent("keydown", init));
    window.dispatchEvent(new KeyboardEvent("keyup", init));
}

const solid = { type: "solid" as const, color: "#ff0000", opacity: 1, visible: true, blend: "normal" as const };

beforeAll(() => {
    useShortcuts();
});

describe("design shortcuts read the physical key", () => {
    let ids: Record<string, string>;
    beforeEach(() => {
        const { doc } = designDoc([
            { type: "rect", name: "A", props: { fills: [solid], strokes: [solid] } },
            { type: "frame", name: "Card 1", x: 200, w: 300, h: 300 },
            { type: "rect", name: "Dot", x: 210, parent: "Card 1" },
            { type: "frame", name: "Card 2", x: 600, w: 300, h: 300 },
            { type: "rect", name: "Dot", x: 610, parent: "Card 2" },
        ]);
        editor.loadDocument(doc, null);
        ids = Object.fromEntries(Object.values(doc.nodes).map((n) => [n.name + (n.x > 600 ? "2" : ""), n.id]));
        editor.set({ selection: [ids.A!], uiMinimized: false, toast: null });
    });

    it("⌥/ removes fills (⌥/ types ÷ on a Mac)", () => {
        press("Slash", "÷", { alt: true });
        expect(editor.get().doc.nodes[ids.A!]!.fills).toEqual([]);
        expect(editor.get().doc.nodes[ids.A!]!.strokes).toHaveLength(1);
    });

    it("⇧/ removes strokes (⇧/ types ?)", () => {
        press("Slash", "?", { shift: true });
        expect(editor.get().doc.nodes[ids.A!]!.strokes).toEqual([]);
        expect(editor.get().doc.nodes[ids.A!]!.fills).toHaveLength(1);
    });

    it("⌥⌘A selects matching layers", () => {
        editor.set({ selection: [ids.Dot!] });
        press("KeyA", "å", { alt: true, meta: true });
        expect(editor.get().selection.sort()).toEqual([ids.Dot!, ids.Dot2!].sort());
    });

    it("⇧⌘\\ minimizes the UI and ⌥⌘\\ toggles multiplayer cursors", () => {
        press("Backslash", "|", { shift: true, meta: true });
        expect(editor.get().uiMinimized).toBe(true);
        const cursors = editor.get().prefs.multiplayerCursors;
        press("Backslash", "«", { alt: true, meta: true });
        expect(editor.get().prefs.multiplayerCursors).toBe(!cursors);
        expect(editor.get().uiHidden).toBe(false);
    });
});

import { describe, expect, it } from "vitest";

await import("../app");
const { SPEC, specItems } = await import("./desktop");
const { ACTION_BY_ID, MAIN_MENU } = await import("./menu-actions");

type Entry = ReturnType<typeof specItems>[number];
const labels = (items: Entry[]): string[] => items.flatMap((e) => (e === "-" ? [] : "sub" in e ? [e.sub, ...labels(e.items)] : [e.label]));

describe("desktop menu bar", () => {
    it("names only actions that exist", () => {
        const ids = Object.values(SPEC).flatMap((entries) => entries.flatMap((e) => (e.includes(":") ? e.slice(e.indexOf(":") + 1).split(",") : [e])));
        expect(ids.filter((id) => id !== "-" && !ACTION_BY_ID.has(id))).toEqual([]);
    });

    it("spells items as the reference does", () => {
        const all = Object.entries(SPEC).flatMap(([menu, entries]) => labels(specItems(menu, entries)));
        for (const label of ["Save to Version History", "Find", "Find Next", "Copy as Text", "CSS", "CSS (all Layers)", "Rotate 180˚", "Union", "Simplify Vector", "Offset Vector", "Run last plugin", "Manage plugins…", "Manage widgets…", "Select all widgets", "Use Smart Quotes/symbols", "Keyboard Zooms into Selection", "Remove All Auto Layout", "Text Align Justified", "Original Case", "Distribute Horizontal Centers", "Pack Vertical", "Round to Pixel", "Open Layers Panel"])
            expect(all).toContain(label);
        for (const label of ["Find…", "Union Selection", "Save to Version History…", "Offset Path…"]) expect(all).not.toContain(label);
    });

    it("keeps the main menu's groups without Back to files", () => {
        const top = MAIN_MENU.map((n) => (typeof n === "string" ? n : n.label));
        expect(top).toEqual(["actions", "-", "File", "Edit", "View", "Object", "Text", "Arrange", "Vector", "-", "Plugins", "Widgets", "Preferences", "libraries", "-", "AI balance", "Help and account"]);
    });
});

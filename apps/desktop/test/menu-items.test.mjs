import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { fileItem } = require("../menu-items.cjs");

describe("the editor's menu items", () => {
    const made = (entry) => {
        const runs = [];
        return { item: fileItem(entry, (win, id) => runs.push([win, id])), runs };
    };
    it("shows a shortcut without ⌘ or ⌃ but doesn't run the item from its key (macOS sets the key equivalent anyway)", () => {
        const { item, runs } = made({ id: "selectNone", label: "Select None", accelerator: "Escape", hint: true, enabled: true });
        assert.equal(item.accelerator, "Escape");
        assert.equal(item.registerAccelerator, false);
        // Escape the page left unconsumed reaches the menu as a key equivalent: the page has already
        // stepped the selection up, so Select none must not run again and clear the parent.
        item.click(item, "win", { triggeredByAccelerator: true });
        assert.deepEqual(runs, []);
        item.click(item, "win", { triggeredByAccelerator: false });
        assert.deepEqual(runs, [["win", "selectNone"]]);
    });
    it("runs a ⌘ shortcut from its key", () => {
        const { item, runs } = made({ id: "duplicate", label: "Duplicate", accelerator: "CommandOrControl+D", enabled: true });
        assert.equal(item.registerAccelerator, undefined);
        item.click(item, "win", { triggeredByAccelerator: true });
        assert.deepEqual(runs, [["win", "duplicate"]]);
    });
    it("builds separators, submenus and checkboxes", () => {
        const { item } = made({ sub: "Align", items: ["-", { id: "pixelGrid", label: "Pixel Grid", accelerator: "Shift+'", hint: true, enabled: true, checked: true }] });
        assert.equal(item.label, "Align");
        assert.deepEqual(item.submenu[0], { type: "separator" });
        assert.equal(item.submenu[1].type, "checkbox");
        assert.equal(item.submenu[1].checked, true);
    });
});

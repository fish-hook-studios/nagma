import { describe, expect, it } from "vitest";

await import("../app");
const { viewport } = await import("./camera");
const { popupLeft, popupTop } = await import("./comment-popup");

describe("comment popups stay on the canvas", () => {
    it("open to the right of the pin, or to the left near the right edge", () => {
        Object.assign(viewport, { width: 900, height: 800 });
        expect(popupLeft(100, 288)).toBe(118);
        // A pin 20 px from the right edge: the box goes to its left instead of under the Comments panel.
        expect(popupLeft(880, 288)).toBe(880 - 18 - 288);
    });
    it("stay above the floating toolbar at the bottom", () => {
        Object.assign(viewport, { width: 900, height: 800 });
        expect(popupTop(780, 112)).toBe(800 - 72 - 112);
        expect(popupTop(-50, 112)).toBe(8);
    });
});

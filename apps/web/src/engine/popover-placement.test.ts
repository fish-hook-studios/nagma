import { describe, expect, it } from "vitest";
import { placePopover } from "./popover-placement";

const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
const size = { w: 256, h: 400 };

describe("placePopover", () => {
    it("goes below the anchor, centred, with the caret pointing up at it", () => {
        const p = placePopover({ anchor: { x: 500, y: 100 }, size, bounds });
        expect(p.side).toBe("bottom");
        expect(p.x).toBe(500 - 128);
        expect(p.y).toBe(112);
        expect(p.caret).toBe(128);
    });

    it("flips above when there is no room below", () => {
        const p = placePopover({ anchor: { x: 500, y: 700 }, size, bounds });
        expect(p.side).toBe("top");
        expect(p.y + size.h).toBe(700 - 12);
        expect(p.caret).toBe(128);
    });

    it("goes right, then left, when neither above nor below fits", () => {
        const tall = { w: 256, h: 600 };
        const right = placePopover({ anchor: { x: 200, y: 400 }, size: tall, bounds });
        expect(right.side).toBe("right");
        expect(right.x).toBe(212);
        expect(right.caret).toBe(400 - right.y);
        const left = placePopover({ anchor: { x: 900, y: 400 }, size: tall, bounds });
        expect(left.side).toBe("left");
        expect(left.x + tall.w).toBe(900 - 12);
    });

    it("clamps inside the bounds and slides the caret to keep pointing at the anchor", () => {
        const p = placePopover({ anchor: { x: 960, y: 100 }, size, bounds });
        expect(p.side).toBe("bottom");
        expect(p.x).toBe(1000 - 8 - 256);
        expect(p.x + p.caret).toBe(960);
    });

    it("keeps the caret out of the rounded corners", () => {
        const p = placePopover({ anchor: { x: 2, y: 100 }, size, bounds });
        expect(p.x).toBe(8);
        expect(p.caret).toBe(16);
    });

    it("pins an off-screen anchor to the edge, staying in view and pointing toward it", () => {
        const p = placePopover({ anchor: { x: -300, y: -200 }, size, bounds });
        expect(p.x).toBeGreaterThanOrEqual(8);
        expect(p.y).toBeGreaterThanOrEqual(8);
        expect(p.side).toBe("bottom");
        expect(p.caret).toBe(16);
    });

    it("uses the side with the most room when nothing fits, still inside the bounds", () => {
        const small = { left: 0, top: 0, right: 300, bottom: 300 };
        const p = placePopover({ anchor: { x: 150, y: 50 }, size, bounds: small });
        expect(p.side).toBe("right");
        expect(p.x).toBe(300 - 8 - 256);
        expect(p.y).toBe(8);
    });

    it("respects the bounds' offset (the canvas between the side panels)", () => {
        const canvas = { left: 240, top: 48, right: 1200, bottom: 900 };
        const p = placePopover({ anchor: { x: 250, y: 300 }, size, bounds: canvas });
        expect(p.x).toBe(248);
        expect(p.x + p.caret).toBe(264);
    });
});

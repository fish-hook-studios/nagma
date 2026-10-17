import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importSketch } from "./sketch-import";

const color = (red: number, green: number, blue: number, alpha = 1) => ({ _class: "color", red, green, blue, alpha });

function sketchFile(page: object): File {
    const zip = zipSync({
        "document.json": strToU8(JSON.stringify({ pages: [{ _ref: "pages/P1" }] })),
        "pages/P1.json": strToU8(JSON.stringify(page)),
    });
    return new File([zip], "Test.sketch");
}

describe("Sketch import", () => {
    it("layers inside artboards and groups land at their place on the page", async () => {
        const page = {
            _class: "page",
            name: "Home",
            layers: [
                {
                    _class: "artboard",
                    name: "Board",
                    frame: { x: 100, y: 50, width: 400, height: 300 },
                    layers: [
                        { _class: "rectangle", name: "Box", frame: { x: 10, y: 20, width: 50, height: 40 }, style: { fills: [{ isEnabled: true, fillType: 0, color: color(1, 0, 0) }] } },
                        {
                            _class: "group",
                            name: "G",
                            frame: { x: 100, y: 100, width: 200, height: 100 },
                            layers: [{ _class: "oval", name: "Dot", frame: { x: 5, y: 5, width: 30, height: 30 } }],
                        },
                    ],
                },
            ],
        };
        const { doc } = await importSketch(sketchFile(page));
        const byName = (name: string) => Object.values(doc.nodes).find((n) => n.name === name);
        expect(byName("Board")).toMatchObject({ x: 100, y: 50, w: 400, h: 300 });
        // Before, children kept Sketch's parent-relative positions, so they fell outside the artboard.
        expect(byName("Box")).toMatchObject({ x: 110, y: 70, w: 50, h: 40 });
        expect(byName("G")).toMatchObject({ x: 200, y: 150 });
        expect(byName("Dot")).toMatchObject({ x: 205, y: 155, w: 30, h: 30 });
    });
});

describe("Sketch import errors", () => {
    it("a damaged file says so instead of quoting the zip reader or JSON parser", async () => {
        await expect(importSketch(new File([], "Empty.sketch"))).rejects.toThrow("it isn't a .sketch file, or it's damaged.");
        const badJson = new File([zipSync({ "document.json": strToU8("{not json") })], "Bad.sketch");
        await expect(importSketch(badJson)).rejects.toThrow("it isn't a .sketch file, or it's damaged.");
    });
});

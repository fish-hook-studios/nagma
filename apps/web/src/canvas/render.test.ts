import { describe, expect, it } from "vitest";

await import("../app");
const { inComponent, needsIsolation } = await import("./render");
const { exportSvg } = await import("../engine/export-svg");
const { designDoc } = await import("../test/design-doc");

const red = { type: "solid" as const, color: "#E53935", opacity: 1, visible: true, blend: "normal" as const };
const black = { ...red, color: "#000000" };

describe("faded groups and masks", () => {
    it("a pass-through group at 50% with overlapping children fades as a whole", () => {
        const { doc, byName } = designDoc([
            { type: "group", name: "G", props: { opacity: 0.5 } },
            { type: "rect", name: "A", parent: "G", props: { fills: [red] } },
            { type: "rect", name: "B", x: 50, parent: "G", props: { fills: [red] } },
        ]);
        const g = doc.nodes[byName.G!.id]!;
        expect(g.blendMode).toBe("pass-through");
        expect(needsIsolation(doc, g)).toBe(true);
        expect(needsIsolation(doc, { ...g, opacity: 1 })).toBe(false);
    });

    it("an alpha mask exports by coverage (a black mask shape keeps what it covers)", () => {
        const { doc, byName } = designDoc([
            { type: "group", name: "G" },
            { type: "ellipse", name: "M", parent: "G", props: { fills: [black], isMask: true, maskType: "alpha" } },
            { type: "rect", name: "R", parent: "G", props: { fills: [red] } },
        ]);
        const svg = exportSvg(doc, byName.G!.id)!;
        expect(svg).toContain('style="mask-type:alpha"');
        expect(svg).toContain("feColorMatrix");
    });

    it("a luminance mask exports as one", () => {
        const { doc, byName } = designDoc([
            { type: "group", name: "G" },
            { type: "ellipse", name: "M", parent: "G", props: { fills: [black], isMask: true, maskType: "luminance" } },
            { type: "rect", name: "R", parent: "G", props: { fills: [red] } },
        ]);
        const svg = exportSvg(doc, byName.G!.id)!;
        expect(svg).not.toContain("mask-type:alpha");
    });
});

describe("selection chrome colour", () => {
    it("components, instances and the layers inside them use the component purple", () => {
        const { doc, byName } = designDoc([
            { type: "component", name: "C" },
            { type: "rect", name: "Inside", parent: "C" },
            { type: "frame", name: "F" },
            { type: "rect", name: "Plain", parent: "F" },
        ]);
        expect(inComponent(doc, doc.nodes[byName.C!.id]!)).toBe(true);
        expect(inComponent(doc, doc.nodes[byName.Inside!.id]!)).toBe(true);
        expect(inComponent(doc, doc.nodes[byName.F!.id]!)).toBe(false);
        expect(inComponent(doc, doc.nodes[byName.Plain!.id]!)).toBe(false);
    });
});

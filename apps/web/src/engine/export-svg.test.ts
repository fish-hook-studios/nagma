import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { defaultEffect } from "./effects";
import { exportAnimatedSvg, exportRegionSvg, exportSelectionSvg, exportSvg } from "./export-svg";
import { makeNode } from "./nodes";
import { imagePaint, linearGradient, solid } from "./paint";
import type { NagmaDocument, Paint, SceneNode } from "./types";
import { PAGE, add, emptyDoc } from "../test/core-fixtures";
import { designDoc } from "../test/design-doc";

function parse(svg: string | null): Document {
    expect(svg).not.toBeNull();
    const dom = new DOMParser().parseFromString(svg as string, "image/svg+xml");
    expect(dom.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(dom.documentElement.nodeName).toBe("svg");
    return dom;
}

const one = (dom: Document, selector: string) => {
    const el = dom.querySelector(selector);
    expect(el, selector).not.toBeNull();
    return el as Element;
};

function single(type: SceneNode["type"], extra: Partial<SceneNode> = {}, rect = { x: 10, y: 20, w: 100, h: 50 }): NagmaDocument {
    return add(emptyDoc(), type, "n", rect, PAGE, extra);
}

describe("SVG export: shapes and paints", () => {
    it("a rectangle with a radius", () => {
        const dom = parse(exportSvg(single("rect", { radius: 8, fills: [solid("#FF0000")] }), "n"));
        const svg = dom.documentElement;
        expect(svg.getAttribute("width")).toBe("100");
        expect(svg.getAttribute("height")).toBe("50");
        expect(svg.getAttribute("viewBox")).toBe("0 0 100 50");
        const r = one(dom, "rect");
        expect([r.getAttribute("x"), r.getAttribute("y"), r.getAttribute("width"), r.getAttribute("height"), r.getAttribute("rx"), r.getAttribute("fill")]).toEqual(["10", "20", "100", "50", "8", "#FF0000"]);
    });

    it("a radius larger than the shape is clamped", () => {
        expect(one(parse(exportSvg(single("rect", { radius: 500 }), "n")), "rect").getAttribute("rx")).toBe("25");
    });

    it("an ellipse", () => {
        const e = one(parse(exportSvg(single("ellipse"), "n")), "ellipse");
        expect([e.getAttribute("cx"), e.getAttribute("cy"), e.getAttribute("rx"), e.getAttribute("ry")]).toEqual(["60", "45", "50", "25"]);
        expect(e.getAttribute("fill")).toBe("#D9D9D9");
    });

    it("a linear gradient is defined and referenced", () => {
        const dom = parse(exportSvg(single("rect", { fills: [linearGradient("#000000", "#FFFFFF")] }), "n"));
        const g = one(dom, "linearGradient");
        expect(one(dom, "rect").getAttribute("fill")).toBe(`url(#${g.getAttribute("id")})`);
        expect([g.getAttribute("x1"), g.getAttribute("y1"), g.getAttribute("x2"), g.getAttribute("y2")]).toEqual(["60", "20", "60", "70"]);
        expect(Array.from(g.querySelectorAll("stop")).map((s) => s.getAttribute("stop-color"))).toEqual(["#000000", "#FFFFFF"]);
    });

    it("an image fill becomes a pattern with the image", () => {
        let doc = single("rect", { fills: [imagePaint("img1", "fit")] });
        doc = applyCommand(doc, { type: "image.add", id: "img1", data: "data:image/png;base64,AAAA" });
        const dom = parse(exportSvg(doc, "n"));
        const pattern = one(dom, "pattern");
        const image = one(dom, "pattern image");
        expect(image.getAttribute("href")).toBe("data:image/png;base64,AAAA");
        expect(image.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
        expect(one(dom, "rect").getAttribute("fill")).toBe(`url(#${pattern.getAttribute("id")})`);
    });

    it("hidden paints and zero-opacity paints are left out", () => {
        const dom = parse(exportSvg(single("rect", { fills: [{ ...solid("#FF0000"), visible: false }, solid("#00FF00", 0), solid("#0000FF", 0.5)] }), "n"));
        const rects = dom.querySelectorAll("rect");
        expect(rects).toHaveLength(1);
        expect(rects[0]!.getAttribute("fill")).toBe("#0000FF");
        expect(rects[0]!.getAttribute("opacity")).toBe("0.5");
    });

    it("text is written as text with its font and content", () => {
        const dom = parse(exportSvg(single("text", { text: "Hi there", fontSize: 16, fontFamily: "Inter" }), "n"));
        const t = one(dom, "text");
        expect(t.textContent).toBe("Hi there");
        expect(t.getAttribute("font-size")).toBe("16");
        expect(t.getAttribute("font-family")).toBe("Inter, sans-serif");
        expect(t.getAttribute("fill")).toBe("#000000");
    });
});

describe("SVG export: strokes", () => {
    const stroke = (align: SceneNode["strokeAlign"]) => single("rect", { strokes: [solid("#112233")], strokeWidth: 4, strokeAlign: align });

    it("centre strokes are drawn at their width", () => {
        const dom = parse(exportSvg(stroke("center"), "n"));
        const s = one(dom, 'rect[stroke="#112233"]');
        expect(s.getAttribute("stroke-width")).toBe("4");
        expect(s.closest("g[clip-path]")).toBeNull();
    });

    it("inside strokes are doubled and clipped to the shape", () => {
        const dom = parse(exportSvg(stroke("inside"), "n"));
        const s = one(dom, 'rect[stroke="#112233"]');
        expect(s.getAttribute("stroke-width")).toBe("8");
        const clip = s.closest("g[clip-path]")!.getAttribute("clip-path")!;
        const id = /url\(#(.+)\)/.exec(clip)![1]!;
        expect(one(dom, `clipPath[id="${id}"] rect`).getAttribute("width")).toBe("100");
    });

    it("outside strokes are doubled and masked out of the shape (even-odd)", () => {
        const dom = parse(exportSvg(stroke("outside"), "n"));
        const s = one(dom, 'rect[stroke="#112233"]');
        expect(s.getAttribute("stroke-width")).toBe("8");
        expect(one(dom, "clipPath path").getAttribute("clip-rule")).toBe("evenodd");
    });

    it("simplify stroke writes inside and outside strokes as centred strokes on an inset or outset box", () => {
        const inside = one(parse(exportSvg(stroke("inside"), "n", { simplifyStroke: true })), 'rect[stroke="#112233"]');
        expect([inside.getAttribute("x"), inside.getAttribute("width"), inside.getAttribute("stroke-width")]).toEqual(["12", "96", "4"]);
        const outside = one(parse(exportSvg(stroke("outside"), "n", { simplifyStroke: true })), 'rect[stroke="#112233"]');
        expect([outside.getAttribute("x"), outside.getAttribute("width")]).toEqual(["8", "104"]);
    });

    it("dashes", () => {
        const dom = parse(exportSvg(single("rect", { strokes: [solid("#000000")], strokeWidth: 1, strokeAlign: "center", dash: [4, 2] }), "n"));
        expect(one(dom, "rect[stroke]").getAttribute("stroke-dasharray")).toBe("4 2");
    });
});

describe("SVG export: structure", () => {
    function frame(extra: Partial<SceneNode> = {}): NagmaDocument {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 200, h: 100 }, PAGE, { name: "Card", ...extra });
        doc = add(doc, "rect", "r", { x: 150, y: 50, w: 100, h: 100 }, "F", { name: "Overflow" });
        doc = add(doc, "rect", "hidden", { x: 0, y: 0, w: 10, h: 10 }, "F", { name: "Gone", visible: false });
        return doc;
    }

    it("a clipping frame clips its children; hidden layers are left out", () => {
        const dom = parse(exportSvg(frame(), "F"));
        const g = one(dom, "g[clip-path]");
        expect(g.querySelector('g[data-name="Overflow"]')).not.toBeNull();
        expect(dom.querySelector('[data-name="Gone"]')).toBeNull();
        const id = /url\(#(.+)\)/.exec(g.getAttribute("clip-path")!)![1]!;
        expect(one(dom, `clipPath[id="${id}"] rect`).getAttribute("width")).toBe("200");
    });

    it("a frame without clipping doesn't clip", () => {
        expect(parse(exportSvg(frame({ clip: false }), "F")).querySelector("g[clip-path]")).toBeNull();
    });

    it("a hidden layer exported on its own is empty", () => {
        const dom = parse(exportSvg(single("rect", { visible: false }), "n"));
        expect(dom.querySelector("rect")).toBeNull();
    });

    it("a group with opacity", () => {
        let doc = emptyDoc();
        doc = applyCommand(doc, {
            type: "batch",
            commands: [
                { type: "node.create", node: makeNode(doc, "group", { x: 0, y: 0, w: 1, h: 1 }, PAGE, { id: "G", name: "Group", opacity: 0.4 }) },
                { type: "node.create", node: makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, "G", { id: "a" }) },
                { type: "node.create", node: makeNode(doc, "ellipse", { x: 20, y: 0, w: 10, h: 10 }, "G", { id: "b" }) },
            ],
        });
        const dom = parse(exportSvg(doc, "G"));
        const g = one(dom, 'g[data-name="Group"]');
        expect(g.getAttribute("opacity")).toBe("0.4");
        expect(g.querySelector("rect")).not.toBeNull();
        expect(g.querySelector("ellipse")).not.toBeNull();
        expect(dom.documentElement.getAttribute("width")).toBe("30");
    });

    it("effects become one filter: drop shadow below, inner shadow above, blur", () => {
        const dom = parse(exportSvg(single("rect", { effects: [defaultEffect("drop-shadow"), defaultEffect("inner-shadow"), defaultEffect("layer-blur")] }), "n"));
        const f = one(dom, "filter");
        expect(one(dom, 'g[data-name]').getAttribute("filter")).toBe(`url(#${f.getAttribute("id")})`);
        const merge = Array.from(f.querySelectorAll("feMergeNode")).map((m) => m.getAttribute("in"));
        expect(merge.indexOf("SourceGraphic")).toBe(1);
        expect(merge).toHaveLength(3);
        expect(f.querySelectorAll("feGaussianBlur")).toHaveLength(3);
        expect(one(dom, "feFlood").getAttribute("flood-opacity")).toBe("0.25");
    });

    it("hidden effects and background blur write no filter", () => {
        const dom = parse(exportSvg(single("rect", { effects: [defaultEffect("drop-shadow", false), defaultEffect("background-blur")] }), "n"));
        expect(dom.querySelector("filter")).toBeNull();
    });

    it("rotation is a transform on the layer", () => {
        const dom = parse(exportSvg(single("rect", { rotation: 90 }), "n"));
        expect(one(dom, "g[data-name]").getAttribute("transform")).toMatch(/^matrix\(/);
        expect(dom.documentElement.getAttribute("width")).toBe("50");
    });

    it("several layers share one frame; regions clip to the rectangle", () => {
        let doc = add(emptyDoc(), "rect", "a", { x: 0, y: 0, w: 10, h: 10 });
        doc = add(doc, "rect", "b", { x: 90, y: 40, w: 10, h: 10 });
        const sel = parse(exportSelectionSvg(doc, ["a", "b"]));
        expect(sel.documentElement.getAttribute("viewBox")).toBe("0 0 100 50");
        expect(sel.querySelectorAll("rect")).toHaveLength(2);
        const region = parse(exportRegionSvg(doc, PAGE, { x: 0, y: 0, w: 50, h: 50 }));
        expect(region.documentElement.getAttribute("width")).toBe("50");
        expect(exportRegionSvg(doc, PAGE, { x: 0, y: 0, w: 0, h: 50 })).toBeNull();
        expect(exportSvg(doc, "missing")).toBeNull();
    });

    it("include id writes unique, XML-safe ids from layer names", () => {
        let doc = add(emptyDoc(), "frame", "F", { x: 0, y: 0, w: 100, h: 100 }, PAGE, { name: "1 Card / main" });
        doc = add(doc, "rect", "a", { x: 0, y: 0, w: 10, h: 10 }, "F", { name: "Box" });
        doc = add(doc, "rect", "b", { x: 0, y: 0, w: 10, h: 10 }, "F", { name: "Box" });
        const ids = Array.from(parse(exportSvg(doc, "F", { includeId: true })).querySelectorAll("g[id]")).map((g) => g.getAttribute("id"));
        expect(ids).toEqual(["_1_Card_main", "Box", "Box_2"]);
    });

    it("an animated frame writes its keyframes as CSS", () => {
        const doc = single("frame", { animation: { tracks: { x: [{ t: 0, v: 10, easing: "linear" }, { t: 1000, v: 110, easing: "ease-in" }] }, duration: 1000 } });
        const dom = parse(exportAnimatedSvg(doc, "n"));
        expect(one(dom, "style").textContent).toContain("@keyframes");
        expect(one(dom, "style").textContent).toContain("translate(100px, 0px)");
    });
});

describe("SVG export: hostile names and values stay inside their attributes", () => {
    const evil = `"><script>alert(1)</script><g x="`;

    it("layer names and text are escaped", () => {
        const doc = single("text", { name: evil, text: `<b>&"bold"</b>` });
        const dom = parse(exportSvg(doc, "n", { includeId: true }));
        expect(dom.querySelector("script")).toBeNull();
        expect(one(dom, "g[data-name]").getAttribute("data-name")).toBe(evil);
        expect(one(dom, "text").textContent).toBe(`<b>&"bold"</b>`);
    });

    it("a font family with quotes is escaped", () => {
        const dom = parse(exportSvg(single("text", { text: "x", fontFamily: evil }), "n"));
        expect(dom.querySelector("script")).toBeNull();
    });

    // Regression: colours, image data and other strings from the document were written into
    // attributes as they were, so a colour like `#fff" onload="…` broke out of its attribute (the
    // SVG is inlined into published site pages).
    const hostilePaints: [string, Paint][] = [
        ["solid colour", { ...solid("#fff"), color: `#fff" onload="alert(1)` }],
        ["gradient stop", { ...linearGradient(), stops: [{ position: 0, color: `red"/><script>alert(1)</script><stop stop-color="`, opacity: 1 }] }],
        ["image data", imagePaint("evil")],
        ["blend mode", { ...solid("#fff"), blend: `multiply" onload="alert(1)` as never }],
    ];
    it.each(hostilePaints)("%s", (_name, paint) => {
        let doc = single("rect", { fills: [paint], strokes: [paint], strokeWidth: 2, strokeJoin: `round" onclick="x` as never, strokeCap: `butt" onclick="x` as never });
        doc = applyCommand(doc, { type: "image.add", id: "evil", data: `data:image/png;base64,AAAA" onerror="alert(1)` });
        const dom = parse(exportSvg(doc, "n"));
        expect(dom.querySelector("script")).toBeNull();
        for (const el of Array.from(dom.querySelectorAll("*"))) for (const a of Array.from(el.attributes)) expect(a.name.startsWith("on")).toBe(false);
    });

    it("a hostile shadow colour and text decoration colour stay inside their attributes", () => {
        const doc = single("text", { text: "x", decoration: "underline", decorationColor: `red;" onmouseover="alert(1)`, effects: [{ ...defaultEffect("drop-shadow"), color: `#000" onload="alert(1)` }] });
        const dom = parse(exportSvg(doc, "n"));
        for (const el of Array.from(dom.querySelectorAll("*"))) for (const a of Array.from(el.attributes)) expect(a.name.startsWith("on")).toBe(false);
    });
});

const black = { type: "solid" as const, color: "#000000", opacity: 1, visible: true, blend: "normal" as const };

describe("SVG export of strokes on some sides", () => {
    it("a dashed top-only stroke is the top line, not the whole outline", () => {
        const { doc, byName } = designDoc([{ type: "rect", name: "R", x: 50, y: 50, w: 100, h: 100, props: { strokes: [black], strokeWidth: 1, dash: [10, 10], strokeSides: { top: true, right: false, bottom: false, left: false } } }]);
        const svg = exportSvg(doc, byName.R!.id)!;
        expect(svg).toContain('d="M50 50H150"');
        expect(svg).toContain('stroke-dasharray="10 10"');
        expect(svg).not.toMatch(/<rect[^>]*stroke=/);
    });
    it("no side on draws no stroke", () => {
        const { doc, byName } = designDoc([{ type: "rect", name: "R", props: { strokes: [black], strokeWidth: 1, dash: [4, 4], strokeSides: { top: false, right: false, bottom: false, left: false } } }]);
        expect(exportSvg(doc, byName.R!.id)!).not.toContain("stroke-dasharray");
    });
});

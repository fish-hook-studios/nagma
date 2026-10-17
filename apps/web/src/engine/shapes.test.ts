import { describe, expect, it } from "vitest";

await import("../app");
const { makeShape } = await import("./shapes");
const { designDoc } = await import("../test/design-doc");
const { activePage } = await import("./page");

describe("shape tool layer names", () => {
    it("lines, arrows, polygons and stars are numbered like other layers", () => {
        let { doc, page } = designDoc([]);
        activePage.id = page.id;
        const names: string[] = [];
        for (const kind of ["line", "line", "arrow", "polygon", "star", "star"] as const) {
            const node = makeShape(doc, kind, { x: 0, y: 0 }, { x: 100, y: 50 }, page.id);
            names.push(node.name);
            const parent = doc.nodes[page.id]!;
            doc = { ...doc, nodes: { ...doc.nodes, [node.id]: node, [page.id]: { ...parent, children: [...parent.children, node.id] } } };
        }
        expect(names).toEqual(["Line 1", "Line 2", "Arrow 1", "Polygon 1", "Star 1", "Star 2"]);
    });
});

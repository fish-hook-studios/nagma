import "../test/prod-fixtures";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { expectConsistentTree, expectFiniteGeometry } from "../test/prod-fixtures";
import { parseFontName } from "../engine/pdf-import";

// importPptx makes a new file and opens it; capture the document instead of storing it.
const made: { kind: string; doc: NagmaDocument; name?: string }[] = [];
vi.mock("../engine/files", async (importOriginal) => {
    const real = await importOriginal<typeof import("../engine/files")>();
    return {
        ...real,
        createFile: (kind: string, doc: NagmaDocument, name?: string) => {
            made.push({ kind, doc, name });
            return { id: `f${made.length}`, name: name ?? doc.name, kind, createdAt: 0, updatedAt: 0 };
        },
        openFile: async () => true,
    };
});

const { importPptx } = await import("./pptx");
const { deckOf, slideIds, SLIDE_W } = await import("./model");

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

const rels = (list: [string, string, string][]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const xfrm = (x: number, y: number, cx: number, cy: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const sp = (opts: { ph?: string; name?: string; box?: string; fill?: string; geom?: string; paras?: string[]; sz?: number; b?: boolean; i?: boolean; algn?: string; color?: string }) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${opts.name ?? "Shape"}"/><p:cNvSpPr/><p:nvPr>${opts.ph ? `<p:ph type="${opts.ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr>${opts.box ?? ""}${opts.geom ? `<a:prstGeom prst="${opts.geom}"/>` : ""}${opts.fill ? `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>` : ""}</p:spPr>${
        opts.paras
            ? `<p:txBody><a:bodyPr/>${opts.paras
                  .map((t, k) => `<a:p>${k === 0 && opts.algn ? `<a:pPr algn="${opts.algn}"/>` : ""}<a:r><a:rPr lang="en-US"${opts.sz ? ` sz="${opts.sz}"` : ""}${opts.b ? ' b="1"' : ""}${opts.i ? ' i="1"' : ""}>${opts.color ? `<a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill>` : ""}</a:rPr><a:t>${t}</a:t></a:r></a:p>`)
                  .join("")}</p:txBody>`
            : ""
    }</p:sp>`;
const slideXml = (body: string, bg?: string) => `<?xml version="1.0"?><p:sld ${NS}><p:cSld>${bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill></p:bgPr></p:bg>` : ""}<p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const notesXml = (text: string) => `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree>${sp({ ph: "sldImg" })}${sp({ ph: "body", paras: text.split("\n") })}</p:spTree></p:cSld></p:notes>`;

// A minimal deck: the presentation lists slides in an order different from their file names.
function buildPptx(slides: { xml: string; rels?: [string, string, string][]; notes?: string }[], extra: Record<string, Uint8Array> = {}, cx = 12192000): Uint8Array {
    const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
        "ppt/presentation.xml": strToU8(`<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${slides.map((_, k) => `<p:sldId id="${256 + k}" r:id="rId${k + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${Math.round((cx * 9) / 16)}"/></p:presentation>`),
        "ppt/_rels/presentation.xml.rels": strToU8(rels(slides.map((_, k) => [`rId${k + 1}`, "slide", `slides/slide${slides.length - k}.xml`]))),
        ...extra,
    };
    slides.forEach((s, k) => {
        const n = slides.length - k;
        files[`ppt/slides/slide${n}.xml`] = strToU8(s.xml);
        const r = [...(s.rels ?? [])];
        if (s.notes !== undefined) {
            files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(notesXml(s.notes));
            r.push(["rIdN", "notesSlide", `../notesSlides/notesSlide${n}.xml`]);
        }
        files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(rels(r));
    });
    return zipSync(files);
}

const pptxFile = (bytes: Uint8Array, name: string) => new File([bytes as Uint8Array<ArrayBuffer>], name);
const EMU = 12192000 / SLIDE_W; // EMU per slide pixel

function slidesOf(doc: NagmaDocument): SceneNode[] {
    return slideIds(doc).map((id) => doc.nodes[id] as SceneNode);
}
const kids = (doc: NagmaDocument, slide: SceneNode) => slide.children.map((id) => doc.nodes[id] as SceneNode);

describe("importPptx", () => {
    beforeEach(() => {
        made.length = 0;
    });

    it("reads slides in presentation order with titles, body text, shapes, pictures, backgrounds and notes", async () => {
        const bytes = buildPptx(
            [
                {
                    xml: slideXml(sp({ ph: "title", name: "Title 1", box: xfrm(100 * EMU, 50 * EMU, 1000 * EMU, 200 * EMU), paras: ["Quarterly &amp; review"], algn: "ctr", color: "FF0000" }) + sp({ name: "Body", box: xfrm(100 * EMU, 300 * EMU, 800 * EMU, 400 * EMU), paras: ["First", "Second"], sz: 1800, i: true }), "112233"),
                    notes: "Speak slowly\nThen clap",
                },
                {
                    xml: slideXml(sp({ name: "Box", box: xfrm(0, 0, 200 * EMU, 100 * EMU), fill: "00FF00" }) + sp({ name: "Dot", box: xfrm(300 * EMU, 0, 100 * EMU, 100 * EMU), fill: "0000ff", geom: "ellipse" }) + `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Pic"/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr>${xfrm(500 * EMU, 500 * EMU, 400 * EMU, 300 * EMU)}</p:spPr></p:pic><p:graphicFrame/>`),
                    rels: [["rIdImg", "image", "../media/image1.png"]],
                },
            ],
            { "ppt/media/image1.png": PNG },
        );
        await importPptx(pptxFile(bytes, "Pitch.pptx"));
        expect(made).toHaveLength(1);
        const { kind, doc, name } = made[0] as (typeof made)[number];
        expect([kind, name]).toEqual(["slides", "Pitch"]);
        expect(doc.slides).toBe(true);
        expect(deckOf(doc).picker).toBe(false);
        const slides = slidesOf(doc);
        expect(slides).toHaveLength(2);

        // Slide 1: background, notes, title and body text.
        const [s1, s2] = slides as [SceneNode, SceneNode];
        expect(s1.fills[0]).toMatchObject({ type: "solid", color: "#112233" });
        expect(s1.deck).toMatchObject({ kind: "slide", notes: "Speak slowly\nThen clap", background: "#112233" });
        const [title, body] = kids(doc, s1).filter((n) => n.type === "text") as [SceneNode, SceneNode];
        expect([title.name, title.text, title.textAlign, title.fontWeight]).toEqual(["Title", "Quarterly & review", "center", 700]);
        expect(title.fills[0]).toMatchObject({ color: "#FF0000" });
        expect([title.x - s1.x, title.y - s1.y, title.w]).toEqual([100, 50, 1000]);
        expect(title.fontSize).toBe(88); // 44pt default title size at 1920 wide
        expect([body.text, body.italic, body.fontWeight, body.fontSize]).toEqual(["First\nSecond", true, 400, 36]);

        // Slide 2: a rectangle, an ellipse and a picture; the chart frame is skipped.
        const shapes = kids(doc, s2);
        expect(shapes.map((n) => [n.type, n.name])).toEqual([
            ["rect", "Box"],
            ["ellipse", "Dot"],
            ["rect", "Picture"],
        ]);
        expect(shapes[1]?.fills[0]).toMatchObject({ color: "#0000FF" });
        const pic = shapes[2] as SceneNode;
        expect([pic.x - s2.x, pic.y - s2.y, pic.w, pic.h]).toEqual([500, 500, 400, 300]);
        const paint = pic.fills[0];
        expect(paint?.type).toBe("image");
        const url = doc.images[paint?.type === "image" ? paint.id : ""] as string;
        expect(url.startsWith("data:image/png;base64,")).toBe(true);
        expect([...Buffer.from(url.split(",")[1] as string, "base64")]).toEqual([...PNG]);
        expect(s2.deck?.kind === "slide" ? s2.deck.notes : "x").toBeUndefined();

        expectConsistentTree(doc);
        expectFiniteGeometry(doc);
    });

    it("scales positions by the presentation's own width (4:3 deck)", async () => {
        const cx = 9144000;
        const per = cx / SLIDE_W;
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(sp({ name: "Box", box: xfrm(960 * per, 0, 480 * per, 100 * per), fill: "123456" })) }], {}, cx), "Old.pptx"));
        const doc = made[0]?.doc as NagmaDocument;
        const [slide] = slidesOf(doc) as [SceneNode];
        const [box] = kids(doc, slide) as [SceneNode];
        expect([box.x - slide.x, box.w]).toEqual([960, 480]);
    });

    it("pictures it can't read are left out, not broken", async () => {
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(`<p:pic><p:blipFill><a:blip r:embed="rIdX"/></p:blipFill></p:pic><p:pic><p:blipFill><a:blip r:embed="rIdE"/></p:blipFill></p:pic>`), rels: [["rIdE", "image", "../media/image.emf"]] }], { "ppt/media/image.emf": Uint8Array.of(1, 2, 3) }), "P.pptx"));
        const doc = made[0]?.doc as NagmaDocument;
        expect(kids(doc, slidesOf(doc)[0] as SceneNode)).toEqual([]);
        expect(Object.keys(doc.images)).toEqual([]);
    });

    it("empty text boxes make no layers; many slides keep their order", async () => {
        const many = Array.from({ length: 12 }, (_, k) => ({ xml: slideXml(sp({ ph: "title", paras: [`Slide title ${k + 1}`] }) + sp({ paras: ["   "] })) }));
        await importPptx(pptxFile(buildPptx(many), "Many.pptx"));
        const doc = made[0]?.doc as NagmaDocument;
        const slides = slidesOf(doc);
        expect(slides.map((s) => kids(doc, s).map((n) => n.text))).toEqual(many.map((_, k) => [`Slide title ${k + 1}`]));
        // Tidied into the deck grid: no two slides overlap.
        const boxes = new Set(slides.map((s) => `${s.x},${s.y}`));
        expect(boxes.size).toBe(slides.length);
    });

    it.each([
        ["not a zip", () => strToU8("hello")],
        ["a zip without a presentation", () => zipSync({ "a.txt": strToU8("x") })],
        ["a presentation with no slides", () => zipSync({ "ppt/presentation.xml": strToU8(`<p:presentation ${NS}><p:sldIdLst/></p:presentation>`) })],
    ])("rejects %s with an Error and makes no file", async (_, make) => {
        await expect(importPptx(pptxFile(make(), "bad.pptx"))).rejects.toBeInstanceOf(Error);
        expect(made).toHaveLength(0);
    });
});

describe("importPptx: other page sizes, groups and damaged numbers (QA regressions)", () => {
    beforeEach(() => {
        made.length = 0;
    });
    const pres = (cx: number | string, cy: number | string, n = 1) => ({
        "ppt/presentation.xml": strToU8(`<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${Array.from({ length: n }, (_, k) => `<p:sldId id="${256 + k}" r:id="rId${k + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/></p:presentation>`),
    });
    const only = (doc: NagmaDocument) => {
        const slide = slidesOf(doc)[0] as SceneNode;
        return { slide, kids: kids(doc, slide) };
    };

    it("letterboxes a 4:3 deck instead of cropping its bottom quarter", async () => {
        // 4:3: 9144000 x 6858000 EMU. A box filling the whole page must stay inside the 1920x1080 slide.
        const bytes = buildPptx([{ xml: slideXml(sp({ name: "Full", box: xfrm(0, 0, 9144000, 6858000), fill: "00FF00" })) }], pres(9144000, 6858000));
        await importPptx(pptxFile(bytes, "four-three.pptx"));
        const { slide, kids: k } = only(made[0]!.doc);
        const box = k[0] as SceneNode;
        expect(box.h).toBeCloseTo(1080);
        expect(box.w).toBeCloseTo(1440);
        expect(box.x - slide.x).toBeCloseTo(240);
        expect(box.y - slide.y).toBeCloseTo(0);
    });

    it("places shapes inside groups through the group's child space", async () => {
        // The group maps child space (0,0 1000x1000) onto (EMU*400, EMU*200) at half size.
        const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${400 * EMU}" y="${200 * EMU}"/><a:ext cx="${500 * EMU}" cy="${500 * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${1000 * EMU}" cy="${1000 * EMU}"/></a:xfrm></p:grpSpPr>${sp({ name: "Inner", box: xfrm(200 * EMU, 100 * EMU, 400 * EMU, 300 * EMU), fill: "FF0000" })}</p:grpSp>`;
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(group) }]), "group.pptx"));
        const { slide, kids: k } = only(made[0]!.doc);
        const inner = k.find((n) => n.name === "Inner") as SceneNode;
        expect(inner.x - slide.x).toBeCloseTo(500);
        expect(inner.y - slide.y).toBeCloseTo(250);
        expect(inner.w).toBeCloseTo(200);
        expect(inner.h).toBeCloseTo(150);
    });

    it("reads only the first choice of alternate content (no duplicate from the fallback)", async () => {
        const alt = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x">${sp({ name: "Choice", box: xfrm(0, 0, 100 * EMU, 100 * EMU), fill: "FF0000" })}</mc:Choice><mc:Fallback>${sp({ name: "Fallback", box: xfrm(0, 0, 100 * EMU, 100 * EMU), fill: "FF0000" })}</mc:Fallback></mc:AlternateContent>`;
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(alt) }]), "alt.pptx"));
        expect(only(made[0]!.doc).kids.map((n) => n.name)).toEqual(["Choice"]);
    });

    it("keeps geometry finite with damaged numbers and a zero page size", async () => {
        const bad = sp({ name: "Bad", box: '<a:xfrm><a:off x="abc" y="1e999"/><a:ext cx="x" cy="-"/></a:xfrm>', fill: "FF0000", paras: ["Hi"], sz: Number.NaN });
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(bad) }], pres(0, 0)), "bad.pptx"));
        const doc = made[0]!.doc;
        expectFiniteGeometry(doc);
        const text = only(doc).kids.find((n) => n.type === "text") as SceneNode;
        expect(Number.isFinite(text.fontSize)).toBe(true);
    });
});

describe("importPptx: a round trip keeps typefaces and lists (QA regression)", () => {
    beforeEach(() => {
        made.length = 0;
    });
    it("reads the run's typeface and bullets", async () => {
        const body = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 800 * EMU, 300 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="2400"><a:latin typeface="Space Grotesk"/></a:rPr><a:t>One</a:t></a:r></a:p></p:txBody></p:sp>`;
        const theme = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Other"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 400 * EMU, 800 * EMU, 300 * EMU)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr lang="en-US"><a:latin typeface="+mn-lt"/></a:rPr><a:t>Two</a:t></a:r></a:p></p:txBody></p:sp>`;
        await importPptx(pptxFile(buildPptx([{ xml: slideXml(body + theme) }]), "fonts.pptx"));
        const doc = made[0]!.doc;
        const texts = kids(doc, slidesOf(doc)[0]!).filter((n) => n.type === "text");
        expect(texts.map((t) => [t.text, t.fontFamily === "Space Grotesk", t.list])).toEqual([
            ["One", true, "bullet"],
            ["Two", false, "number"],
        ]);
    });
});

describe("pdf import: font names (the pure part; page drawing needs pdf.js)", () => {
    // Regression: "TimesNewRomanPS" lost "Roman" (read as a glued style word), giving "Times New".
    it.each([
        [{ name: "TimesNewRomanPSMT" }, { family: "Times New Roman", weight: 400, italic: false }],
        [{ name: "Times-Roman" }, { family: "Times", weight: 400, italic: false }],
        [{ name: "ABCDEF+TimesNewRomanPS-BoldItalicMT" }, { family: "Times New Roman", weight: 700, italic: true }],
        [{ name: "Helvetica" }, { family: "Helvetica", weight: 400, italic: false }],
        [{ name: "Helvetica-Oblique" }, { family: "Helvetica", weight: 400, italic: true }],
        [{ name: "MontserratSemiBold" }, { family: "Montserrat", weight: 600, italic: false }],
        [{ name: "Inter-Light" }, { family: "Inter", weight: 300, italic: false }],
        [{ name: "Roboto-Black" }, { family: "Roboto", weight: 900, italic: false }],
        [{ name: "Arial,Bold" }, { family: "Arial", weight: 700, italic: false }],
        [{ name: "Foo", bold: true }, { family: "Foo", weight: 700, italic: false }],
        [{ name: "Foo", weight: 500, italic: true }, { family: "Foo", weight: 500, italic: true }],
        [{ name: "XYZABC+Whatever", family: "Real Family" }, { family: "Real Family", weight: 400, italic: false }],
        [{ name: "" }, { family: "Inter", weight: 400, italic: false }],
    ])("parseFontName(%j)", (font, want) => {
        expect(parseFontName(font)).toEqual(want);
    });
});

describe("pptx import of a damaged file", () => {
    it("an empty or cut-off file says it's damaged, not 'invalid zip data'", async () => {
        await expect(importPptx(new File([], "Empty.pptx"))).rejects.toThrow("This isn't a .pptx presentation, or it's damaged.");
        await expect(importPptx(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2])], "Cut.pptx"))).rejects.toThrow("or it's damaged.");
    });
});

import { drawNode } from "../canvas/render";
import { preloadImages } from "../engine/image-store";
import type { NagmaDocument, Paint, SceneNode, TextSpan } from "../engine/types";
import { slideOf } from "./model";
import { drawSlide } from "./render";

// Writes slides as a .pptx presentation. "Editable" keeps text boxes (fonts, sizes, colours,
// weight, alignment, lists), plain rectangles and ellipses as real objects and turns everything
// else (pictures, tables, charts, code, live widgets, vectors, gradients) into pictures of
// themselves; "flat" makes each slide one picture. Presenter notes go in the notes pages.

const EMU = 6350; // per slide pixel: 1920 px is 12192000 EMU (13.33 in)
const PICTURE_SCALE = 2;

// XML can't hold most control characters (a vertical tab pasted with some text made PowerPoint
// ask to repair the file); they're dropped.
// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emu = (px: number) => Math.round(px * EMU);
const hex = (color: string) => color.replace("#", "").slice(0, 6).toUpperCase().padEnd(6, "0");

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type Rel = { id: string; type: string; target: string; external?: boolean };

function rels(items: Rel[]): string {
    return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;
}

function solidOf(fills: Paint[] | undefined): { color: string; alpha: number } | null {
    const paint = (fills ?? []).filter((p) => p.visible).at(-1);
    if (!paint || paint.type !== "solid") return null;
    return { color: hex(paint.color), alpha: paint.opacity };
}

function fillXml(fill: { color: string; alpha: number } | null): string {
    if (!fill) return "<a:noFill/>";
    return `<a:solidFill><a:srgbClr val="${fill.color}">${fill.alpha < 1 ? `<a:alpha val="${Math.round(fill.alpha * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>`;
}

function xfrm(node: SceneNode, slide: SceneNode): string {
    const rot = node.rotation ? ` rot="${Math.round((((node.rotation % 360) + 360) % 360) * 60000)}"` : "";
    return `<a:xfrm${rot}><a:off x="${emu(node.x - slide.x)}" y="${emu(node.y - slide.y)}"/><a:ext cx="${emu(Math.max(1, node.w))}" cy="${emu(Math.max(1, node.h))}"/></a:xfrm>`;
}

// ---- Text ----

function runProps(node: SceneNode, span: Partial<TextSpan>): string {
    const size = span.fontSize ?? node.fontSize ?? 24;
    const weight = span.fontWeight ?? node.fontWeight ?? 400;
    const italic = span.italic ?? node.italic;
    const decoration = span.decoration ?? node.decoration;
    const fill = solidOf(span.fills ?? node.fills);
    const font = esc(span.fontFamily ?? node.fontFamily ?? "Inter");
    return `<a:rPr lang="en-US" sz="${Math.round(size * 50)}"${weight >= 600 ? ' b="1"' : ""}${italic ? ' i="1"' : ""}${decoration === "underline" ? ' u="sng"' : ""}${decoration === "strikethrough" ? ' strike="sngStrike"' : ""} dirty="0">${fillXml(fill)}<a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:rPr>`;
}

// A paragraph's runs, split where spans change the style.
function runsXml(node: SceneNode, text: string, offset: number): string {
    if (!text) return "";
    const cuts = new Set([0, text.length]);
    const spans = (node.spans ?? []).filter((s) => s.end > offset && s.start < offset + text.length);
    for (const s of spans) {
        cuts.add(Math.max(0, s.start - offset));
        cuts.add(Math.min(text.length, s.end - offset));
    }
    const points = [...cuts].sort((a, b) => a - b);
    let out = "";
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i] as number;
        const b = points[i + 1] as number;
        if (a === b) continue;
        const span = spans.filter((s) => s.start - offset <= a && s.end - offset >= b).reduce<Partial<TextSpan>>((acc, s) => ({ ...acc, ...s }), {});
        out += `<a:r>${runProps(node, span)}<a:t>${esc(text.slice(a, b))}</a:t></a:r>`;
    }
    return out;
}

function textBodyXml(node: SceneNode): string {
    const align = node.textAlign === "center" ? "ctr" : node.textAlign === "right" ? "r" : node.textAlign === "justify" ? "just" : "l";
    const anchor = node.textAlignV === "middle" ? "ctr" : node.textAlignV === "bottom" ? "b" : "t";
    const lines = (node.text ?? "").split("\n");
    let offset = 0;
    const lineHeight = node.lineHeight ? `<a:lnSpc><a:spcPct val="${Math.round(node.lineHeight * 100000)}"/></a:lnSpc>` : "";
    const paragraphs = lines.map((line, i) => {
        const style = node.paragraphs?.[i];
        const list = style ? style.list : node.list;
        const level = Math.max(0, (style?.level ?? (list ? 1 : 0)) - 1);
        const size = node.fontSize ?? 24;
        const indent = list ? ` marL="${emu(size * 1.2 * (level + 1))}" indent="${-emu(size * 1.2)}"` : "";
        const bullet = list === "bullet" ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : list === "number" ? '<a:buAutoNum type="arabicPeriod"/>' : "<a:buNone/>";
        const xml = `<a:p><a:pPr algn="${align}"${indent}${level ? ` lvl="${level}"` : ""}>${lineHeight}${bullet}</a:pPr>${runsXml(node, line, offset)}<a:endParaRPr lang="en-US" sz="${Math.round(size * 50)}" dirty="0"/></a:p>`;
        offset += line.length + 1;
        return xml;
    });
    return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join("")}</p:txBody>`;
}

// ---- Pictures ----

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

async function pictureOf(doc: NagmaDocument, node: SceneNode): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(node.w * PICTURE_SCALE));
    canvas.height = Math.max(1, Math.round(node.h * PICTURE_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PICTURE_SCALE, PICTURE_SCALE);
    // Drawn unrotated: the picture itself turns in the presentation.
    ctx.translate(-node.x, -node.y);
    drawNode(ctx, doc, { ...node, rotation: 0 }, { editingTextId: null, pixelScale: PICTURE_SCALE });
    return canvasBlob(canvas);
}

async function slidePicture(doc: NagmaDocument, slide: SceneNode, layers: boolean): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(slide.w * PICTURE_SCALE);
    canvas.height = Math.round(slide.h * PICTURE_SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PICTURE_SCALE, PICTURE_SCALE);
    drawSlide(ctx, doc, slide, PICTURE_SCALE, undefined, layers ? undefined : () => false);
    return canvasBlob(canvas);
}

// ---- Package parts ----

const THEME = (name: string) =>
    `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="F24E1E"/></a:accent1><a:accent2><a:srgbClr val="FF7237"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>${CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = `${XML}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLR_MAP}<p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

function notesSlide(notes: string): string {
    const paragraphs = notes.split("\n").map((line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(line)}</a:t></a:r></a:p>`).join("");
    return `${XML}<p:notes ${NS}><p:cSld><p:spTree>${EMPTY_TREE}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

// ---- Slides ----

interface Media {
    name: string;
    blob: Blob;
}

async function slideXml(doc: NagmaDocument, slide: SceneNode, flat: boolean, media: Media[], slideRels: Rel[]): Promise<string> {
    let shapeId = 2;
    const shapes: string[] = [];
    const picture = async (blob: Blob | null, node: SceneNode | null, name: string) => {
        if (!blob) return;
        const file = `image${media.length + 1}.png`;
        media.push({ name: file, blob });
        const rid = `rId${slideRels.length + 1}`;
        slideRels.push({ id: rid, type: "image", target: `../media/${file}` });
        const id = shapeId++;
        const box = node ? xfrm(node, slide) : `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(slide.w)}" cy="${emu(slide.h)}"/></a:xfrm>`;
        const descr = node?.altText ? ` descr="${esc(node.altText)}"` : "";
        shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}"${descr}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${box}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    };

    const bgFill = solidOf(slide.fills);
    let background = "";
    if (flat) await picture(await slidePicture(doc, slide, true), null, "Slide");
    else if (bgFill) background = `<p:bg><p:bgPr>${fillXml(bgFill)}<a:effectLst/></p:bgPr></p:bg>`;
    else await picture(await slidePicture(doc, slide, false), null, "Background");

    if (!flat) {
        for (const childId of slide.children) {
            const node = doc.nodes[childId];
            if (!node || !node.visible) continue;
            const fill = solidOf(node.fills);
            const plainFills = node.fills.every((p) => !p.visible || p.type === "solid");
            const simple = !node.children.length && plainFills && !node.effects?.length && !node.shadow && !node.blur && node.opacity === 1;
            if (node.type === "text" && simple) {
                const id = shapeId++;
                const link = node.hyperlink && /^(https?:|mailto:)/.test(node.hyperlink) ? node.hyperlink : null;
                let click = "";
                if (link) {
                    const rid = `rId${slideRels.length + 1}`;
                    slideRels.push({ id: rid, type: "hyperlink", target: esc(link), external: true });
                    click = `<a:hlinkClick r:id="${rid}"/>`;
                }
                shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(node.name)}">${click}</p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(node, slide)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBodyXml(node)}</p:sp>`);
            } else if ((node.type === "rect" || node.type === "ellipse") && simple) {
                const id = shapeId++;
                const radius = node.type === "rect" ? node.radius : 0;
                const geom = node.type === "ellipse" ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' : radius > 0 ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (radius / Math.max(1, Math.min(node.w, node.h))) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
                const stroke = solidOf(node.strokes);
                const line = stroke && node.strokeWidth > 0 ? `<a:ln w="${emu(node.strokeWidth)}">${fillXml(stroke)}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
                shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(node.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(node, slide)}${geom}${fillXml(fill)}${line}</p:spPr></p:sp>`);
            } else await picture(await pictureOf(doc, node), node, node.name);
        }
    }
    return `${XML}<p:sld ${NS}><p:cSld>${background}<p:spTree>${EMPTY_TREE}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export async function buildPptx(doc: NagmaDocument, ids: string[], options: { flat: boolean }): Promise<Blob> {
    await preloadImages(doc.images);
    const { strToU8, zipSync } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    const put = (path: string, text: string) => (files[path] = strToU8(text));
    const media: Media[] = [];
    const first = doc.nodes[ids[0] ?? ""];
    const cx = emu(first?.w ?? 1920);
    const cy = emu(first?.h ?? 1080);

    const slides: string[] = [];
    for (const [i, id] of ids.entries()) {
        const slide = doc.nodes[id];
        if (!slide) continue;
        const n = i + 1;
        const slideRels: Rel[] = [{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }];
        const xml = await slideXml(doc, slide, options.flat, media, slideRels);
        const notes = slideOf(slide)?.notes?.trim();
        if (notes) {
            slideRels.push({ id: `rId${slideRels.length + 1}`, type: "notesSlide", target: `../notesSlides/notesSlide${n}.xml` });
            put(`ppt/notesSlides/notesSlide${n}.xml`, notesSlide(notes));
            put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([{ id: "rId1", type: "notesMaster", target: "../notesMasters/notesMaster1.xml" }, { id: "rId2", type: "slide", target: `../slides/slide${n}.xml` }]));
        }
        put(`ppt/slides/slide${n}.xml`, xml);
        put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
        slides.push(`slide${n}.xml`);
    }
    for (const m of media) files[`ppt/media/${m.name}`] = new Uint8Array(await m.blob.arrayBuffer());
    const hasNotes = Object.keys(files).some((p) => p.startsWith("ppt/notesSlides/"));

    const presRels = [
        { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
        { id: "rId2", type: "theme", target: "theme/theme1.xml" },
        { id: "rId3", type: "presProps", target: "presProps.xml" },
        { id: "rId4", type: "viewProps", target: "viewProps.xml" },
        { id: "rId5", type: "tableStyles", target: "tableStyles.xml" },
        ...(hasNotes ? [{ id: "rId6", type: "notesMaster", target: "notesMasters/notesMaster1.xml" }] : []),
        ...slides.map((s, i) => ({ id: `rId${10 + i}`, type: "slide", target: `slides/${s}` })),
    ];
    put(
        "ppt/presentation.xml",
        `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst>' : ""}<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`,
    );
    put("ppt/_rels/presentation.xml.rels", rels(presRels));
    put("ppt/presProps.xml", `${XML}<p:presentationPr ${NS}/>`);
    put("ppt/viewProps.xml", `${XML}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
    put("ppt/tableStyles.xml", `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
    put("ppt/slideMasters/slideMaster1.xml", MASTER);
    put("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: "theme", target: "../theme/theme1.xml" }]));
    put("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
    put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]));
    put("ppt/theme/theme1.xml", THEME("Slides"));
    if (hasNotes) {
        put("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER);
        put("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels([{ id: "rId1", type: "theme", target: "../theme/theme2.xml" }]));
        put("ppt/theme/theme2.xml", THEME("Notes"));
    }
    put(
        "docProps/app.xml",
        `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nagma</Application><Slides>${slides.length}</Slides></Properties>`,
    );
    put(
        "docProps/core.xml",
        `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.name || "Slides")}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
    );
    put(
        "_rels/.rels",
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    );
    const PML = "application/vnd.openxmlformats-officedocument.presentationml";
    const overrides = [
        ["/ppt/presentation.xml", `${PML}.presentation.main+xml`],
        ["/ppt/presProps.xml", `${PML}.presProps+xml`],
        ["/ppt/viewProps.xml", `${PML}.viewProps+xml`],
        ["/ppt/tableStyles.xml", `${PML}.tableStyles+xml`],
        ["/ppt/slideMasters/slideMaster1.xml", `${PML}.slideMaster+xml`],
        ["/ppt/slideLayouts/slideLayout1.xml", `${PML}.slideLayout+xml`],
        ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
        ...(hasNotes ? [["/ppt/notesMasters/notesMaster1.xml", `${PML}.notesMaster+xml`], ["/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml"]] : []),
        ...slides.map((s) => [`/ppt/slides/${s}`, `${PML}.slide+xml`]),
        ...Object.keys(files)
            .filter((p) => /^ppt\/notesSlides\/[^/]+\.xml$/.test(p))
            .map((p) => [`/${p}`, `${PML}.notesSlide+xml`]),
        ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
        ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ];
    put(
        "[Content_Types].xml",
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("")}</Types>`,
    );
    return new Blob([zipSync(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

import { unzipSync } from "fflate";
import { nanoid } from "nanoid";
import { applyCommand } from "../engine/commands";
import { createFile, openFile } from "../engine/files";
import { makeNode } from "../engine/nodes";
import { imagePaint, solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { SLIDE_H, SLIDE_W, addSlideCommands, createSlidesDocument, deckPage, slideIds, tidyCommands } from "./model";

// Opens a .pptx as a new slides file: each slide's text boxes (with size, weight, colour and
// alignment of their first run), pictures, plain rectangles' fills, background colour and speaker
// notes. Masters, layouts' own decorations, charts, tables, SmartArt and animations aren't read.

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" };

function xml(files: Record<string, Uint8Array>, path: string): Document | null {
    const bytes = files[path];
    return bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml") : null;
}

function rels(files: Record<string, Uint8Array>, path: string): Map<string, { target: string; type: string }> {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const doc = xml(files, `${dir}/_rels/${name}.rels`);
    const out = new Map<string, { target: string; type: string }>();
    for (const r of Array.from(doc?.getElementsByTagName("Relationship") ?? [])) {
        out.set(r.getAttribute("Id") ?? "", { target: resolve(dir, r.getAttribute("Target") ?? ""), type: r.getAttribute("Type") ?? "" });
    }
    return out;
}

function resolve(dir: string, target: string): string {
    if (target.startsWith("/")) return target.slice(1);
    const parts = dir.split("/");
    for (const seg of target.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
}

function first(el: Element | Document, tag: string): Element | null {
    return el.getElementsByTagName(tag)[0] ?? null;
}

function color(el: Element | null): string | null {
    const fill = el ? first(el, "a:srgbClr") : null;
    const val = fill?.getAttribute("val");
    return val ? `#${val.toUpperCase()}` : null;
}

// A finite number from an attribute, else the fallback (a hand-made or damaged file can hold
// anything there).
function num(value: string | null | undefined, fallback: number): number {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? n : fallback;
}

// Shapes inside groups (p:grpSp) are placed in the group's child space (chOff/chExt); this maps
// them to slide space through every enclosing group: X = x * sx + tx.
interface Place {
    sx: number;
    sy: number;
    tx: number;
    ty: number;
}
function groupPlace(el: Element): Place {
    let place: Place = { sx: 1, sy: 1, tx: 0, ty: 0 };
    for (let g = el.parentElement; g; g = g.parentElement) {
        if (g.tagName !== "p:grpSp") continue;
        const props = Array.from(g.children).find((c) => c.tagName === "p:grpSpPr");
        const xf = props ? first(props, "a:xfrm") : null;
        if (!xf) continue;
        const off = first(xf, "a:off");
        const ext = first(xf, "a:ext");
        const chOff = first(xf, "a:chOff");
        const chExt = first(xf, "a:chExt");
        const cw = num(chExt?.getAttribute("cx"), 0);
        const ch = num(chExt?.getAttribute("cy"), 0);
        const gx = cw > 0 ? num(ext?.getAttribute("cx"), cw) / cw : 1;
        const gy = ch > 0 ? num(ext?.getAttribute("cy"), ch) / ch : 1;
        const ox = num(off?.getAttribute("x"), 0) - num(chOff?.getAttribute("x"), 0) * gx;
        const oy = num(off?.getAttribute("y"), 0) - num(chOff?.getAttribute("y"), 0) * gy;
        place = { sx: place.sx * gx, sy: place.sy * gy, tx: place.tx * gx + ox, ty: place.ty * gy + oy };
    }
    return place;
}

// Alternate content keeps a fallback copy of what its first choice holds; only the choice is read.
function inFallback(el: Element): boolean {
    for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === "mc:Fallback") return true;
    return false;
}

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function paragraphs(body: Element): string {
    return Array.from(body.getElementsByTagName("a:p"))
        .map((p) => Array.from(p.getElementsByTagName("a:t")).map((t) => t.textContent ?? "").join(""))
        .join("\n");
}

export async function importPptx(file: File) {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
        // An empty or cut-off file: not the zip reader's "invalid zip data".
        throw new Error("This isn't a .pptx presentation, or it's damaged.");
    }
    const pres = xml(files, "ppt/presentation.xml");
    if (!pres) throw new Error("This isn't a .pptx presentation.");
    // The deck's page fits the 16:9 slide whole (a 4:3 deck is letterboxed, not cropped).
    const size = first(pres, "p:sldSz");
    const cxRead = num(size?.getAttribute("cx"), 12192000);
    const cx = cxRead > 0 ? cxRead : 12192000;
    const cyRead = num(size?.getAttribute("cy"), (cx * SLIDE_H) / SLIDE_W);
    const cy = cyRead > 0 ? cyRead : (cx * SLIDE_H) / SLIDE_W;
    const scale = Math.min(SLIDE_W / cx, SLIDE_H / cy);
    const padX = (SLIDE_W - cx * scale) / 2;
    const padY = (SLIDE_H - cy * scale) / 2;
    const presRels = rels(files, "ppt/presentation.xml");
    const order = Array.from(pres.getElementsByTagName("p:sldId")).map((s) => presRels.get(s.getAttribute("r:id") ?? "")?.target).filter((t): t is string => Boolean(t));
    const name = file.name.replace(/\.pptx$/i, "");
    let doc: NagmaDocument = createSlidesDocument(name);
    // The new file starts with a title slide; the imported slides replace it, and no template picker shows.
    doc = applyCommand(doc, { type: "node.delete", ids: slideIds(doc) });
    const page = deckPage(doc);
    if (page?.deck?.kind === "deck") doc = applyCommand(doc, { type: "node.update", id: page.id, patch: { deck: { ...page.deck, picker: false } } });
    const skipped = new Set<string>();
    for (const path of order) {
        const slideXml = xml(files, path);
        if (!slideXml) continue;
        const slideRels = rels(files, path);
        const made = addSlideCommands(doc, "blank");
        doc = applyCommand(doc, { type: "batch", commands: made.commands });
        const slide = doc.nodes[made.id] as SceneNode;
        const commands: Command[] = [];
        const bg = color(first(slideXml, "p:bg"));
        const notesRel = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"));
        const notesXml = notesRel ? xml(files, notesRel.target) : null;
        const notes = notesXml
            ? Array.from(notesXml.getElementsByTagName("p:sp"))
                  .filter((sp) => first(sp, "p:ph")?.getAttribute("type") === "body")
                  .map((sp) => (first(sp, "p:txBody") ? paragraphs(first(sp, "p:txBody") as Element) : ""))
                  .join("\n")
                  .trim()
            : "";
        commands.push({ type: "node.update", id: slide.id, patch: { ...(bg ? { fills: [solid(bg)] } : {}), deck: { kind: "slide", layout: "blank", section: slide.deck?.kind === "slide" ? slide.deck.section : undefined, notes: notes || undefined, background: bg } } });
        let current = applyCommand(doc, { type: "batch", commands });
        const add = (node: SceneNode) => {
            commands.push({ type: "node.create", node });
            current = applyCommand(current, { type: "node.create", node });
        };
        const box = (el: Element, fallback: { x: number; y: number; w: number; h: number }, g: Place) => {
            const off = first(el, "a:off");
            const ext = first(el, "a:ext");
            if (!off || !ext) return fallback;
            return {
                x: slide.x + padX + (num(off.getAttribute("x"), 0) * g.sx + g.tx) * scale,
                y: slide.y + padY + (num(off.getAttribute("y"), 0) * g.sy + g.ty) * scale,
                w: Math.max(4, num(ext.getAttribute("cx"), 0) * g.sx * scale),
                h: Math.max(4, num(ext.getAttribute("cy"), 0) * g.sy * scale),
            };
        };
        for (const el of Array.from(slideXml.getElementsByTagName("*"))) {
            const tag = el.tagName;
            if ((tag === "p:sp" || tag === "p:pic" || tag === "p:graphicFrame") && inFallback(el)) continue;
            const g = tag === "p:sp" || tag === "p:pic" ? groupPlace(el) : { sx: 1, sy: 1, tx: 0, ty: 0 };
            if (tag === "p:sp") {
                const ph = first(el, "p:ph")?.getAttribute("type");
                const isTitle = ph === "title" || ph === "ctrTitle";
                const fallback = isTitle ? { x: slide.x + 120, y: slide.y + 100, w: slide.w - 240, h: 160 } : { x: slide.x + 120, y: slide.y + 300, w: slide.w - 240, h: 600 };
                const b = box(first(el, "p:spPr") ?? el, fallback, g);
                const spPr = first(el, "p:spPr");
                const fill = spPr && first(spPr, "a:solidFill") ? color(first(spPr, "a:solidFill")) : null;
                if (fill) add(makeNode(current, first(el, "a:prstGeom")?.getAttribute("prst") === "ellipse" ? "ellipse" : "rect", b, slide.id, { name: el.getElementsByTagName("p:cNvPr")[0]?.getAttribute("name") ?? "Shape", fills: [solid(fill)] }));
                const body = first(el, "p:txBody");
                const content = body ? paragraphs(body) : "";
                if (!body || !content.trim()) continue;
                const rPr = first(body, "a:rPr") ?? first(body, "a:defRPr");
                const pt = num(rPr?.getAttribute("sz"), isTitle ? 4400 : 2400) / 100;
                const pPr = first(body, "a:pPr");
                const algn = pPr?.getAttribute("algn");
                const runColor = rPr ? color(first(rPr, "a:solidFill")) : null;
                // The run's typeface (not a theme reference like "+mn-lt") and the list kind, which
                // a round trip through .pptx used to drop (Nagma's own export writes both).
                const face = rPr ? first(rPr, "a:latin")?.getAttribute("typeface") : null;
                const list = pPr && first(pPr, "a:buChar") ? "bullet" : pPr && first(pPr, "a:buAutoNum") ? "number" : null;
                add(
                    makeNode(current, "text", b, slide.id, {
                        name: isTitle ? "Title" : "Text",
                        text: content,
                        fontSize: Math.max(8, Math.round(pt * 12700 * scale * Math.min(g.sx, g.sy))),
                        fontWeight: rPr?.getAttribute("b") === "1" || isTitle ? 700 : 400,
                        italic: rPr?.getAttribute("i") === "1",
                        textAlign: algn === "ctr" ? "center" : algn === "r" ? "right" : "left",
                        ...(face && !face.startsWith("+") ? { fontFamily: face } : {}),
                        ...(list ? { list } : {}),
                        fills: [solid(runColor ?? "#1E1E1E")],
                        sizing: { h: "fixed", v: "hug" },
                        lineHeight: 1.2,
                        deck: { kind: "text", role: isTitle ? "heading" : "body" },
                    }),
                );
            } else if (tag === "p:pic") {
                const embed = first(el, "a:blip")?.getAttribute("r:embed");
                const target = embed ? slideRels.get(embed)?.target : undefined;
                const bytes = target ? files[target] : undefined;
                const ext = target?.split(".").pop()?.toLowerCase() ?? "";
                if (!bytes || !MIME[ext]) {
                    skipped.add("some pictures");
                    continue;
                }
                const id = nanoid(10);
                commands.push({ type: "image.add", id, data: `data:${MIME[ext]};base64,${toBase64(bytes)}` });
                current = applyCommand(current, { type: "image.add", id, data: "" });
                add(makeNode(current, "rect", box(first(el, "p:spPr") ?? el, { x: slide.x, y: slide.y, w: 400, h: 300 }, g), slide.id, { name: "Picture", fills: [imagePaint(id)] }));
            } else if (tag === "p:graphicFrame") skipped.add("tables and charts");
        }
        doc = applyCommand(doc, { type: "batch", commands });
    }
    if (!slideIds(doc).length) throw new Error("No slides found.");
    doc = applyCommand(doc, { type: "batch", commands: tidyCommands(doc) });
    const meta = createFile("slides", doc, name);
    await openFile(meta.id);
    editor.notify(skipped.size ? `Opened ${file.name}. Not carried over: ${[...skipped].join(", ")}.` : `Opened ${file.name}.`);
}

export function pickPptx() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) void importPptx(file).catch((error) => editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    };
    input.click();
}

import { nanoid } from "nanoid";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import type { Command, NagmaDocument, NodePatch, SceneNode } from "../engine/types";
import "./sync";
import type { BreakpointId, Collection, CollectionField, CollectionItem, SiteBreakpointData, SiteLibraryData, SiteNodeData, SitePageData, SiteSettings } from "./types";

// Site documents: pages with a frame per breakpoint, the library page with the settings and the
// CMS, and helpers to find your way around them.

export interface Breakpoint {
    id: BreakpointId;
    label: string;
    // The frame's width on the canvas.
    width: number;
    // The window widths this breakpoint is used for once published (max is null for the primary
    // breakpoint, which covers everything wider). The smallest breakpoint always starts at 0.
    min: number;
    max: number | null;
    // The start width as set (before the smallest breakpoint's range is stretched down to 0).
    start: number;
    frameId?: string;
}

// Every new page starts with these; more can be added (and these deleted) per page.
// Migration (pass 6): Tablet is 800 wide from 800 (it was 768 from 768). New pages store their starts on
// the frames, so pages made before keep their 768 Tablet (and a frame without a stored start still
// reads as 768, see DEFAULT_MIN); only new pages, and Tablets added from the "+" menu, use 800.
export const BREAKPOINTS: Breakpoint[] = [
    { id: "desktop", label: "Desktop", width: 1280, min: 1024, max: null, start: 1024 },
    { id: "tablet", label: "Tablet", width: 800, min: 800, max: 1023, start: 800 },
    { id: "mobile", label: "Mobile", width: 375, min: 0, max: 767, start: 375 },
];
// Offered when adding a breakpoint (Custom asks for a width).
export const BREAKPOINT_PRESETS: { label: string; width: number; min: number }[] = [
    { label: "Tablet", width: 800, min: 800 },
    { label: "Mobile", width: 375, min: 375 },
    { label: "Large phone", width: 430, min: 430 },
    { label: "Small laptop", width: 1024, min: 1024 },
];
// Where the default breakpoints start when a frame has no start of its own (only frames from before
// starts were stored; Tablet kept its old 768 there); any other starts at its own width.
const DEFAULT_MIN: Record<string, number> = { desktop: 1024, tablet: 768 };
export const BREAKPOINT_GAP = 160;
export const PRIMARY_BP: BreakpointId = "desktop";
export const bpX = (id: BreakpointId): number => {
    let x = 0;
    for (const b of BREAKPOINTS) {
        if (b.id === id) return x;
        x += b.width + BREAKPOINT_GAP;
    }
    return x;
};

// A page's breakpoints, primary first then narrower ones, with their ranges worked out.
const bpCache = new WeakMap<object, Map<string, Breakpoint[]>>();
export function breakpointsOf(doc: NagmaDocument, pageId: string): Breakpoint[] {
    let byPage = bpCache.get(doc.nodes);
    if (!byPage) bpCache.set(doc.nodes, (byPage = new Map()));
    const hit = byPage.get(pageId);
    if (hit) return hit;
    const list: Breakpoint[] = [];
    for (const id of doc.nodes[pageId]?.children ?? []) {
        const frame = doc.nodes[id];
        const data = bpData(frame);
        if (!frame || !data || list.some((b) => b.id === data.bp)) continue;
        const start = Math.max(0, data.min ?? DEFAULT_MIN[data.bp] ?? Math.round(frame.w));
        list.push({ id: data.bp, label: frame.name, width: Math.round(frame.w), min: start, max: null, start, frameId: frame.id });
    }
    const primary = list.find((b) => b.id === PRIMARY_BP);
    const rest = list.filter((b) => b !== primary).sort((a, b) => b.min - a.min || b.width - a.width);
    const out = primary ? [primary, ...rest] : rest;
    for (let i = 1; i < out.length; i++) {
        const b = out[i] as Breakpoint;
        const above = out[i - 1] as Breakpoint;
        b.min = Math.min(b.min, Math.max(0, above.min - 1));
        b.max = above.min - 1;
    }
    const last = out[out.length - 1];
    if (last && out.length > 1) last.min = 0;
    byPage.set(pageId, out);
    return out;
}

export function breakpointOf(doc: NagmaDocument, pageId: string, bp: BreakpointId): Breakpoint | undefined {
    return breakpointsOf(doc, pageId).find((b) => b.id === bp);
}

// "Tablet 800 to 1023", "Desktop 1024 and wider", "Mobile up to 799".
export function rangeLabel(b: Breakpoint): string {
    if (b.max === null) return `${b.min} and wider`;
    if (b.min <= 0) return `up to ${b.max}`;
    return `${b.min} to ${b.max}`;
}

// The breakpoint a copy on `bp` follows: the next wider one (the primary for the widest).
export function parentBreakpoint(doc: NagmaDocument, pageId: string, bp: BreakpointId): BreakpointId | null {
    const list = breakpointsOf(doc, pageId);
    const at = list.findIndex((b) => b.id === bp);
    return at > 0 ? (list[at - 1]?.id ?? null) : null;
}

export const DEFAULT_SETTINGS: SiteSettings = {
    title: "",
    description: "",
    lang: "en",
    favicon: null,
    socialImage: null,
    fonts: [],
    webFonts: true,
    analytics: "",
    headCode: "",
    bodyCode: "",
    transition: "fade",
    noindex: false,
};

export const pageData = (node: SceneNode | undefined): SitePageData | null => (node?.site && "kind" in node.site && node.site.kind === "page" ? node.site : null);
export const libraryData = (node: SceneNode | undefined): SiteLibraryData | null => (node?.site && "kind" in node.site && node.site.kind === "library" ? node.site : null);
export const bpData = (node: SceneNode | undefined): SiteBreakpointData | null => (node?.site && "kind" in node.site && node.site.kind === "bp" ? node.site : null);
export const webData = (node: SceneNode | undefined): SiteNodeData => (node?.site && !("kind" in node.site && node.site.kind) ? (node.site as SiteNodeData) : {});

// Cached per document state, so UI selectors get the same array back while nothing changed.
const pagesCache = new WeakMap<object, { roots: string[]; pages: SceneNode[] }>();
export function sitePages(doc: NagmaDocument): SceneNode[] {
    const hit = pagesCache.get(doc.nodes);
    if (hit && hit.roots === doc.roots) return hit.pages;
    const pages = doc.roots.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(pageData(n)));
    pagesCache.set(doc.nodes, { roots: doc.roots, pages });
    return pages;
}

export function libraryPage(doc: NagmaDocument): SceneNode | undefined {
    for (const id of doc.roots) if (libraryData(doc.nodes[id])) return doc.nodes[id];
    return undefined;
}

const settingsCache = new WeakMap<object, SiteSettings>();
export function settingsOf(doc: NagmaDocument): SiteSettings {
    const lib = libraryPage(doc);
    const hit = lib && settingsCache.get(lib);
    if (hit) return hit;
    const settings = { ...DEFAULT_SETTINGS, ...libraryData(lib)?.settings };
    if (lib) settingsCache.set(lib, settings);
    return settings;
}

const NO_COLLECTIONS: Collection[] = [];
export function collectionsOf(doc: NagmaDocument): Collection[] {
    return libraryData(libraryPage(doc))?.collections ?? NO_COLLECTIONS;
}

export function collectionOf(doc: NagmaDocument, id: string | null | undefined): Collection | undefined {
    return id ? collectionsOf(doc).find((c) => c.id === id) : undefined;
}

export function libraryCommand(doc: NagmaDocument, patch: Partial<Omit<SiteLibraryData, "kind">>): Command | null {
    const page = libraryPage(doc);
    const data = libraryData(page);
    if (!page || !data) return null;
    return { type: "node.update", id: page.id, patch: { site: { ...data, ...patch } } };
}

// The breakpoint frames of a page, by breakpoint.
export function bpFrames(doc: NagmaDocument, pageId: string): Partial<Record<BreakpointId, SceneNode>> {
    const out: Partial<Record<BreakpointId, SceneNode>> = {};
    for (const id of doc.nodes[pageId]?.children ?? []) {
        const node = doc.nodes[id];
        const data = bpData(node);
        if (node && data && !out[data.bp]) out[data.bp] = node;
    }
    return out;
}

// The breakpoint frame a layer sits in (or is), and the page.
export function bpOfNode(doc: NagmaDocument, id: string | null | undefined): { frame: SceneNode; bp: BreakpointId } | null {
    let node = id ? doc.nodes[id] : undefined;
    while (node) {
        const data = bpData(node);
        if (data) return { frame: node, bp: data.bp };
        node = node.parentId ? doc.nodes[node.parentId] : undefined;
    }
    return null;
}

// The primary (desktop) layer a breakpoint copy mirrors; the layer itself when it is primary.
export function primaryOf(doc: NagmaDocument, id: string): string {
    const node = doc.nodes[id];
    const data = bpData(node);
    if (data && data.bp !== "desktop" && node?.parentId) return bpFrames(doc, node.parentId).desktop?.id ?? id;
    const src = webData(node).src;
    if (src && doc.nodes[src]) return src;
    const m = BP_COPY.exec(id);
    return m?.[1] && doc.nodes[m[1]] ? m[1] : id;
}

export const mirrorIdFor = (sourceId: string, bp: BreakpointId) => `${sourceId}@${bp}`;
// "<primary layer id>@<breakpoint>": a breakpoint's copy of a primary layer.
export const BP_COPY = /^(.*)@([A-Za-z0-9_-]+)$/;

// The copy of a primary layer on another breakpoint.
export function mirrorOf(doc: NagmaDocument, sourceId: string, bp: BreakpointId): string | null {
    if (bp === "desktop") return sourceId;
    const node = doc.nodes[sourceId];
    if (bpData(node) && node?.parentId) return bpFrames(doc, node.parentId)[bp]?.id ?? null;
    const id = mirrorIdFor(sourceId, bp);
    return doc.nodes[id] ? id : null;
}

export function pageOfNode(doc: NagmaDocument, id: string): SceneNode | undefined {
    let node = doc.nodes[id];
    while (node && node.parentId) node = doc.nodes[node.parentId];
    return node?.type === "page" ? node : undefined;
}

export function slugify(text: string): string {
    return (
        text
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "item"
    );
}

// "/About us" → "/about-us"; "" or "/" → "/".
export function normalizePath(path: string): string {
    const parts = path
        .split("/")
        .map((p) => slugify(p))
        .filter((p) => p && p !== "item");
    return `/${parts.join("/")}`;
}

export function uniquePath(doc: NagmaDocument, wanted: string, except?: string): string {
    const taken = new Set(sitePages(doc).filter((p) => p.id !== except).map((p) => pageData(p)?.path));
    let path = normalizePath(wanted);
    let n = 2;
    const base = path === "/" ? "/page" : path;
    while (taken.has(path)) path = `${base}-${n++}`;
    return path;
}

// ---- Adding, editing and deleting breakpoints ----

// Puts a page's breakpoint frames side by side, widest first.
export function arrangeBreakpointsCommands(doc: NagmaDocument, pageId: string): Command[] {
    const list = breakpointsOf(doc, pageId);
    const first = list[0]?.frameId ? doc.nodes[list[0].frameId] : undefined;
    if (!first) return [];
    const out: Command[] = [];
    let x = first.x;
    for (const b of list) {
        const frame = b.frameId ? doc.nodes[b.frameId] : undefined;
        if (!frame) continue;
        if (Math.round(frame.x) !== Math.round(x) || Math.round(frame.y) !== Math.round(first.y)) out.push({ type: "node.move", ids: [frame.id], dx: x - frame.x, dy: first.y - frame.y });
        x += frame.w + BREAKPOINT_GAP;
    }
    return out;
}

// Checks a breakpoint's start against its neighbours; returns why it can't be used, or null.
export function breakpointProblem(doc: NagmaDocument, pageId: string, min: number, except?: BreakpointId): string | null {
    const list = breakpointsOf(doc, pageId).filter((b) => b.id !== except);
    const primary = list[0];
    if (!Number.isFinite(min) || min < 0 || min > 10000) return "Use a width between 0 and 10000.";
    if (except === PRIMARY_BP) {
        // (The primary itself is filtered out above, so the widest other breakpoint is first.)
        const widest = list.find((b) => b.id !== PRIMARY_BP);
        return widest && min <= widest.min ? `The primary breakpoint must start above ${widest.label} (${widest.min}).` : null;
    }
    if (primary && primary.id === PRIMARY_BP && min >= primary.min) return `Breakpoints start below ${primary.label} (${primary.min}). Lower it first to add a wider one.`;
    const clash = list.find((b) => b.id !== PRIMARY_BP && b.start === min);
    return clash ? `${clash.label} already starts at ${min}.` : null;
}

// A new breakpoint: its frame copies the next wider breakpoint's frame, and the layers follow it
// (the site sync fills them in).
export function addBreakpointCommands(doc: NagmaDocument, pageId: string, spec: { label: string; width: number; min: number }): { commands: Command[]; bp: BreakpointId } | { error: string } {
    const problem = breakpointProblem(doc, pageId, spec.min);
    if (problem) return { error: problem };
    const list = breakpointsOf(doc, pageId);
    const primaryFrame = list[0]?.frameId ? doc.nodes[list[0].frameId] : undefined;
    if (!primaryFrame || list[0]?.id !== PRIMARY_BP) return { error: "This page has no primary breakpoint." };
    const wanted = slugify(spec.label).replace(/[^a-z0-9-]/g, "");
    const bp = wanted && wanted !== "item" && !list.some((b) => b.id === wanted) ? wanted : `bp${nanoid(6).replace(/[^A-Za-z0-9]/g, "x")}`;
    const wider = [...list].reverse().find((b) => b.min > spec.min) ?? list[0];
    const template = (wider?.frameId ? doc.nodes[wider.frameId] : undefined) ?? primaryFrame;
    const right = Math.max(...list.map((b) => (b.frameId ? (doc.nodes[b.frameId]?.x ?? 0) + (doc.nodes[b.frameId]?.w ?? 0) : 0)));
    const width = Math.max(120, Math.min(4000, Math.round(spec.width)));
    const frame: SceneNode = {
        ...template,
        id: mirrorIdFor(primaryFrame.id, bp),
        name: spec.label.trim() || "Breakpoint",
        x: right + BREAKPOINT_GAP,
        y: primaryFrame.y,
        w: width,
        children: [],
        site: { kind: "bp", bp, min: Math.round(spec.min), ov: [] },
    };
    return { commands: [{ type: "node.create", node: frame }], bp };
}

export function updateBreakpointCommand(doc: NagmaDocument, pageId: string, bp: BreakpointId, patch: { label?: string; width?: number; min?: number }): Command | { error: string } | null {
    const frame = bpFrames(doc, pageId)[bp];
    const data = bpData(frame);
    if (!frame || !data) return null;
    const node: NodePatch = {};
    if (patch.label !== undefined && patch.label.trim()) node.name = patch.label.trim();
    if (patch.width !== undefined && Number.isFinite(patch.width)) node.w = Math.max(120, Math.min(4000, Math.round(patch.width)));
    if (patch.min !== undefined) {
        const problem = breakpointProblem(doc, pageId, Math.round(patch.min), bp);
        if (problem) return { error: problem };
        node.site = { ...data, min: Math.round(patch.min) };
    }
    return Object.keys(node).length ? { type: "node.update", id: frame.id, patch: node } : null;
}

export function deleteBreakpointCommand(doc: NagmaDocument, pageId: string, bp: BreakpointId): Command | null {
    if (bp === PRIMARY_BP) return null;
    const frame = bpFrames(doc, pageId)[bp];
    return frame ? { type: "node.delete", ids: [frame.id] } : null;
}

// The page's scroll behaviour, kept on its primary breakpoint frame (none stored: down only).
export function pageOverflow(doc: NagmaDocument, frameId: string): "y" | "both" {
    return bpData(doc.nodes[primaryOf(doc, frameId)])?.overflow ?? "y";
}

// ---- Creating pages ----

// A page and its breakpoint frames: each a white stack that hugs its content (at least a screen tall).
export function pageNodes(doc: NagmaDocument, name: string, data: Omit<SitePageData, "kind">): SceneNode[] {
    const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name, site: { kind: "page", ...data } });
    const out: SceneNode[] = [page];
    let desktop: SceneNode | null = null;
    for (const b of BREAKPOINTS) {
        const frame = makeNode(doc, "frame", { x: bpX(b.id), y: 0, w: b.width, h: 900 }, page.id, {
            id: desktop ? mirrorIdFor(desktop.id, b.id) : nanoid(10),
            name: b.label,
            fills: [solid("#FFFFFF")],
            clip: true,
            layout: { direction: "vertical", gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" },
            sizing: { h: "fixed", v: "hug" },
            minH: 900,
            site: { kind: "bp", bp: b.id, ...(b.id === "mobile" ? {} : { min: b.min }), ov: [], ...(desktop ? {} : { overflow: "both" as const }) },
        });
        if (!desktop) desktop = frame;
        out.push(frame);
        page.children.push(frame.id);
    }
    return out;
}

export function createSiteDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {}, site: true };
    const home = pageNodes(base, "Home", { path: "/" });
    const library = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, {
        name: "Components",
        site: { kind: "library", settings: { ...DEFAULT_SETTINGS, title: name }, collections: [] },
    });
    const nodes: Record<string, SceneNode> = {};
    for (const n of [...home, library]) nodes[n.id] = n;
    return { ...base, nodes, roots: [home[0]?.id as string, library.id] };
}

// Commands that add a page (before the library page, so the home page stays first).
export function addPageCommands(doc: NagmaDocument, name: string, data: Omit<SitePageData, "kind">): { commands: Command[]; pageId: string } {
    const nodes = pageNodes(doc, name, data);
    const lib = libraryPage(doc);
    const index = lib ? doc.roots.indexOf(lib.id) : doc.roots.length;
    const commands: Command[] = nodes.map((node, i) => ({ type: "node.create" as const, node: { ...node, children: [] }, ...(i === 0 ? { index } : {}) }));
    return { commands, pageId: nodes[0]?.id as string };
}

// ---- CMS ----

export function newCollection(name: string): Collection {
    const title = { id: nanoid(6), name: "Title", type: "text" as const };
    const summary = { id: nanoid(6), name: "Summary", type: "text" as const };
    const image = { id: nanoid(6), name: "Image", type: "image" as const };
    return { id: nanoid(8), name, fields: [title, summary, image], items: [] };
}

export function itemTitle(collection: Collection, item: CollectionItem): string {
    const first = collection.fields[0];
    return (first ? item.values[first.id] : "") || item.slug;
}

export function uniqueSlug(collection: Collection, wanted: string, except?: string): string {
    const taken = new Set(collection.items.filter((i) => i.id !== except).map((i) => i.slug));
    const base = slugify(wanted);
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    return slug;
}

// What a bound field shows for an item, as plain text.
export function fieldText(collection: Collection | undefined, item: CollectionItem | undefined, fieldId: string): string {
    if (!collection || !item) return "";
    if (fieldId === "slug") return item.slug;
    const field = collection.fields.find((f) => f.id === fieldId);
    const raw = item.values[fieldId] ?? "";
    if (!field) return "";
    if (field.type === "richtext") return raw.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    if (field.type === "date" && raw) {
        const style = { year: "numeric", month: "long", day: "numeric" } as const;
        // A plain date ("2024-01-05", what the CMS and CSVs hold) is that day wherever the site is
        // built, not midnight UTC shown a day early west of Greenwich; one that doesn't exist
        // ("2024-02-30") shows as written rather than rolling over into March.
        const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
        if (plain) {
            const [y, m, d] = [Number(plain[1]), Number(plain[2]), Number(plain[3])];
            const date = new Date(Date.UTC(y, m - 1, d));
            if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return raw;
            return date.toLocaleDateString("en", { ...style, timeZone: "UTC" });
        }
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("en", style);
    }
    return raw;
}

// The page used for a collection's items, if there is one.
export function itemPageFor(doc: NagmaDocument, collectionId: string): SceneNode | undefined {
    return sitePages(doc).find((p) => pageData(p)?.collectionId === collectionId);
}

// ---- CSV import ----

// Rows of a CSV file (quoted fields, doubled quotes, commas or semicolons, CRLF or LF).
export function parseCsv(text: string): string[][] {
    const src = text.replace(/^﻿/, "");
    const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
    const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i] as string;
        if (quoted) {
            if (c === '"' && src[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"' && cell === "") quoted = true;
        else if (c === sep) {
            row.push(cell);
            cell = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && src[i + 1] === "\n") i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else cell += c;
    }
    if (cell !== "" || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Adds a CSV's rows to a collection as items: columns match fields by name (a "slug" column sets
// the address); other columns become new fields, typed from their values.
export function importCsv(collection: Collection, rows: string[][]): { collection: Collection; added: number } {
    const [header, ...body] = rows;
    if (!header || !body.length) return { collection, added: 0 };
    const fields = [...collection.fields];
    const columns: (string | "slug" | null)[] = header.map((name, col) => {
        const clean = name.trim();
        if (!clean) return null;
        if (/^slug$/i.test(clean)) return "slug";
        const known = fields.find((f) => f.name.toLowerCase() === clean.toLowerCase());
        if (known) return known.id;
        const values = body.map((r) => (r[col] ?? "").trim()).filter(Boolean);
        const type: CollectionField["type"] = values.length && values.every((v) => /^-?\d+(\.\d+)?$/.test(v))
            ? "number"
            : values.length && values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))
              ? "date"
              : values.length && values.every((v) => /^https?:\/\//i.test(v))
                ? "link"
                : values.some((v) => /<\/?(p|br|b|strong|em|i|ul|li|a)\b/i.test(v))
                  ? "richtext"
                  : "text";
        const field: CollectionField = { id: nanoid(6), name: clean, type };
        fields.push(field);
        return field.id;
    });
    let next: Collection = { ...collection, fields };
    let added = 0;
    for (const r of body) {
        const values: Record<string, string> = {};
        let slug = "";
        columns.forEach((id, col) => {
            const v = (r[col] ?? "").trim();
            if (!id || !v) return;
            if (id === "slug") slug = v;
            else values[id] = v;
        });
        const titleId = fields[0]?.id;
        const item: CollectionItem = { id: nanoid(8), slug: uniqueSlug(next, slug || (titleId ? values[titleId] : "") || "item"), values };
        next = { ...next, items: [...next.items, item] };
        added++;
    }
    return { collection: next, added };
}

// The collection a layer is listed from (it sits inside a collection list), if any.
export function insideList(doc: NagmaDocument, id: string): string | null {
    let node: SceneNode | undefined = doc.nodes[primaryOf(doc, id)];
    while (node) {
        const list = webData(node).list;
        if (list) return list.collectionId;
        node = node.parentId ? doc.nodes[node.parentId] : undefined;
    }
    return null;
}

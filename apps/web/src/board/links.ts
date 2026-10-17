import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { textSize } from "../engine/text";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { placeAt } from "./actions";
import { authHeaders } from "../engine/auth";
import type { JamData } from "./types";

// Link previews: a pasted web address becomes a card with the page's site, title, description and
// picture (looked up by the sync server, which only fetches public pages), shown horizontally,
// vertically or minimized to one line. Addresses of videos, maps, music and Nagma files become
// live embeds instead (through each service's public embed address), which play right on the
// board once selected, can be maximized, or minimized to a card. Any preview can change back to
// plain linked text.

type Link = Extract<JamData, { kind: "link" }>;
export type LinkDisplay = "horizontal" | "vertical" | "minimized";

export const LINK_W = 360;
export const LINK_H = 132;
// The bar above an embed (site and title), which is where it's picked up and moved.
export const EMBED_HEADER = 32;

export function linkFrom(text: string): string | null {
    const t = text.trim();
    if (!/^https?:\/\/\S+$/i.test(t)) return null;
    try {
        return new URL(t).toString();
    } catch {
        return null;
    }
}

// A link card's or embed's address as stored in the shared file, checked again where it's used:
// only web addresses open or play (a crafted file could hold javascript: or anything else).
export function webUrl(url: string | null | undefined): string | null {
    return url ? linkFrom(url) : null;
}

// Opens a link card's page in a new tab, if it's a web address.
export function openWebUrl(url: string | null | undefined) {
    const safe = webUrl(url);
    if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}

// Embedded players can run their own scripts and open popups, but never steer this page.
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

export interface EmbedInfo {
    src: string;
    kind: "video" | "map" | "audio" | "file";
    site: string;
    // The embed's size on the board (its header included).
    w: number;
    h: number;
}

// The public embed address for a link, when the service has one.
export function embedFor(raw: string): EmbedInfo | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const host = url.hostname.replace(/^(www|m)\./, "");
    const video = (src: string, site: string): EmbedInfo => ({ src, kind: "video", site, w: 480, h: 270 + EMBED_HEADER });
    if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
        const id = host === "youtu.be" ? url.pathname.slice(1) : (url.searchParams.get("v") ?? /^\/(shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[2]);
        if (id && /^[\w-]{6,20}$/.test(id)) {
            const start = Number.parseInt(url.searchParams.get("t") ?? "", 10);
            return video(`https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ""}`, "YouTube");
        }
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
        const id = /(\d{5,})/.exec(url.pathname)?.[1];
        if (id) return video(`https://player.vimeo.com/video/${id}`, "Vimeo");
    }
    if (host === "loom.com") {
        const id = /^\/(share|embed)\/([\w-]+)/.exec(url.pathname)?.[2];
        if (id) return video(`https://www.loom.com/embed/${id}`, "Loom");
    }
    if ((host === "google.com" || host.startsWith("google.") || host === "maps.google.com") && (url.pathname.startsWith("/maps") || host === "maps.google.com")) {
        // A place's name, or the map's centre and zoom.
        const place = /\/maps\/place\/([^/]+)/.exec(url.pathname)?.[1];
        const at = /@(-?[\d.]+),(-?[\d.]+),(\d+(?:\.\d+)?)z/.exec(url.pathname);
        const q = url.searchParams.get("q") ?? (place ? decodeURIComponent(place.replace(/\+/g, " ")) : at ? `${at[1]},${at[2]}` : null);
        if (q) return { src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${at ? Math.round(Number(at[3])) : 14}&output=embed`, kind: "map", site: "Google Maps", w: 480, h: 360 + EMBED_HEADER };
    }
    if (host === "openstreetmap.org") {
        const m = /map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(url.hash);
        if (m) {
            const z = Number(m[1]);
            const lat = Number(m[2]);
            const lon = Number(m[3]);
            const span = 360 / 2 ** z;
            return { src: `https://www.openstreetmap.org/export/embed.html?bbox=${lon - span},${lat - span / 2},${lon + span},${lat + span / 2}&layer=mapnik&marker=${lat},${lon}`, kind: "map", site: "OpenStreetMap", w: 480, h: 360 + EMBED_HEADER };
        }
    }
    if (host === "open.spotify.com") {
        const m = /^\/(track|album|playlist|episode|show|artist)\/(\w+)/.exec(url.pathname);
        if (m) return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: "audio", site: "Spotify", w: 400, h: (m[1] === "track" || m[1] === "episode" ? 152 : 352) + EMBED_HEADER };
    }
    if (host === "soundcloud.com" && url.pathname.split("/").filter(Boolean).length >= 2) {
        return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}`, kind: "audio", site: "SoundCloud", w: 400, h: 166 + EMBED_HEADER };
    }
    // A Nagma design file, board or prototype shared from this app: shown live.
    if (url.origin === location.origin && url.searchParams.get("file")) return { src: url.toString(), kind: "file", site: "Nagma", w: 560, h: 360 + EMBED_HEADER };
    return null;
}

function makeLink(doc: NagmaDocument, x: number, y: number, parentId: string | null, url: string, embed: EmbedInfo | null): SceneNode {
    const w = embed?.w ?? LINK_W;
    const h = embed?.h ?? LINK_H;
    return makeNode(doc, "rect", { x: x - w / 2, y: y - h / 2, w, h }, parentId, {
        name: embed ? embed.site : hostOf(url),
        fills: [solid("#FFFFFF")],
        strokes: [solid("#E6E6E6")],
        strokeWidth: 1,
        radius: 12,
        hyperlink: url,
        jam: { kind: "link", url, ...(embed ? { embed: embed.src, embedKind: embed.kind, site: embed.site } : {}) },
    });
}

// Adds a preview for `url` centred on a world point (a live embed when the address has one), then
// fills in the page's details.
export function placeLink(world: { x: number; y: number }, url: string): string {
    const s = editor.get();
    const at = placeAt(s.doc, world.x, world.y);
    const node = makeLink(s.doc, at.x, at.y, at.parentId, url, embedFor(url));
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
    void unfurl(node.id, url);
    return node.id;
}

async function unfurl(id: string, url: string) {
    try {
        const res = await fetch(`${httpBase()}/unfurl?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000), headers: authHeaders() });
        if (!res.ok) return;
        const info = (await res.json()) as { title?: string | null; description?: string | null; site?: string | null; image?: string | null };
        const node = editor.get().doc.nodes[id];
        if (node?.jam?.kind !== "link" || (!info.title && !info.description)) return;
        // The details aren't an edit of their own.
        editor.executeSilently({ type: "node.update", id, patch: { name: info.title || node.name, jam: { ...node.jam, title: info.title ?? undefined, description: info.description ?? undefined, site: node.jam.embed ? node.jam.site : (info.site ?? undefined), image: info.image ?? undefined } } });
    } catch {
        // No server, or the page didn't answer: the card keeps showing the address.
    }
}

// The size a card takes for a display.
export function cardSize(display: LinkDisplay, hasImage: boolean): { w: number; h: number } {
    if (display === "minimized") return { w: 320, h: 48 };
    if (display === "vertical") return { w: 320, h: hasImage ? 320 : 180 };
    return { w: hasImage ? 480 : LINK_W, h: LINK_H };
}

// Shows a card horizontally, vertically or minimized (an embed minimized becomes a one-line card;
// expanded again, it plays in place).
export function setLinkDisplay(id: string, display: LinkDisplay) {
    const node = editor.get().doc.nodes[id];
    if (node?.jam?.kind !== "link") return;
    const jam = node.jam;
    let size = cardSize(display, Boolean(jam.image));
    if (jam.embed && display !== "minimized") {
        const info = embedFor(jam.url);
        size = info ? { w: info.w, h: info.h } : size;
    }
    editor.execute({ type: "node.update", id, patch: { jam: { ...jam, display: display === "horizontal" ? undefined : display }, x: node.x + (node.w - size.w) / 2, w: size.w, h: size.h } });
}

// Turns a preview back into its address as linked text.
export function linkToText(id: string) {
    const doc = editor.get().doc;
    const node = doc.nodes[id];
    if (node?.jam?.kind !== "link") return;
    const url = node.jam.url;
    const draft = makeNode(doc, "text", { x: 0, y: 0, w: 1, h: 20 }, node.parentId, { text: url, name: url.slice(0, 40), fontSize: 16, fontFamily: "Inter", fills: [solid("#0C8CE9")], decoration: "underline", hyperlink: url });
    const size = textSize(draft);
    const text = { ...draft, x: node.x, y: node.y + node.h / 2 - size.h / 2, w: size.w, h: size.h };
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const index = parent ? parent.children.indexOf(id) : -1;
    editor.execute({ type: "batch", commands: [{ type: "node.create", node: text, ...(index >= 0 ? { index } : {}) }, { type: "node.delete", ids: [id] }] });
    editor.set({ selection: [text.id] });
}

// ---- Drawing ----

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
    const words = text.split(/\s+/);
    const out: string[] = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > width && line) {
            out.push(line);
            line = word;
            if (out.length === lines) break;
        } else line = next;
    }
    if (out.length < lines && line) out.push(line);
    if (out.length === lines && words.join(" ") !== out.join(" ")) {
        let last = out[lines - 1] ?? "";
        while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
        out[lines - 1] = `${last}…`;
    }
    return out;
}

// Pictures for cards, loaded once each (the board redraws when one arrives).
const pictures = new Map<string, HTMLImageElement | null>();
function picture(src: string): HTMLImageElement | null {
    if (pictures.has(src)) {
        const img = pictures.get(src) ?? null;
        return img && img.complete && img.naturalWidth ? img : null;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => editor.set({});
    img.onerror = () => pictures.set(src, null);
    img.src = src;
    pictures.set(src, img);
    return null;
}

function globe(ctx: CanvasRenderingContext2D, gx: number, gy: number) {
    ctx.strokeStyle = "#757575";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(gx, gy, 7, 0, Math.PI * 2);
    ctx.moveTo(gx - 7, gy);
    ctx.lineTo(gx + 7, gy);
    ctx.ellipse(gx, gy, 3.2, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / k;
    const sh = h / k;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

export function drawLink(ctx: CanvasRenderingContext2D, node: SceneNode, jam: Link) {
    const { x, y, w, h } = node;
    const pad = 16;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#E6E6E6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.clip();
    const site = jam.site || hostOf(jam.url);
    const title = jam.title || jam.url;
    ctx.textAlign = "left";
    if (jam.embed && jam.display !== "minimized") {
        // An embed: the header, and under it the player (laid over the board while on screen; this
        // stands in for it in exports and while it loads).
        ctx.textBaseline = "middle";
        globe(ctx, x + 18, y + EMBED_HEADER / 2);
        ctx.font = "600 12px Inter, system-ui, sans-serif";
        ctx.fillStyle = "#1E1E1E";
        ctx.fillText(jam.title ? `${site} · ${jam.title}` : site, x + 32, y + EMBED_HEADER / 2, w - 44);
        ctx.fillStyle = jam.embedKind === "map" ? "#E8EEF2" : jam.embedKind === "file" ? "#2C2C2C" : "#1E1E1E";
        ctx.fillRect(x, y + EMBED_HEADER, w, h - EMBED_HEADER);
        const img = jam.image ? picture(jam.image) : null;
        if (img) cover(ctx, img, x, y + EMBED_HEADER, w, h - EMBED_HEADER);
        const cx = x + w / 2;
        const cy = y + EMBED_HEADER + (h - EMBED_HEADER) / 2;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1E1E1E";
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 9);
        ctx.lineTo(cx + 10, cy);
        ctx.lineTo(cx - 6, cy + 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
    if (jam.display === "minimized") {
        ctx.textBaseline = "middle";
        globe(ctx, x + 22, y + h / 2);
        ctx.font = "600 13px Inter, system-ui, sans-serif";
        ctx.fillStyle = "#1E1E1E";
        ctx.fillText(wrap(ctx, title, w - 52, 1)[0] ?? "", x + 38, y + h / 2, w - 52);
        ctx.restore();
        return;
    }
    const img = jam.image ? picture(jam.image) : null;
    let tx = x + pad;
    let ty = y + pad;
    let tw = w - pad * 2;
    if (jam.image) {
        if (jam.display === "vertical") {
            const ih = Math.round(h * 0.5);
            ctx.fillStyle = "#F5F5F5";
            ctx.fillRect(x, y, w, ih);
            if (img) cover(ctx, img, x, y, w, ih);
            ty = y + ih + 12;
        } else {
            const iw = h;
            ctx.fillStyle = "#F5F5F5";
            ctx.fillRect(x, y, iw, h);
            if (img) cover(ctx, img, x, y, iw, h);
            tx = x + iw + pad;
            tw = w - iw - pad * 2;
        }
    }
    ctx.textBaseline = "middle";
    globe(ctx, tx + 8, ty + 8);
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#757575";
    ctx.fillText(site, tx + 22, ty + 8, tw - 22);
    ty += 30;
    ctx.textBaseline = "top";
    ctx.font = "600 15px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#1E1E1E";
    for (const line of wrap(ctx, title, tw, jam.description ? 2 : 3)) {
        ctx.fillText(line, tx, ty);
        ty += 20;
    }
    if (jam.description) {
        ctx.font = "400 12px Inter, system-ui, sans-serif";
        ctx.fillStyle = "#5C5C5C";
        ty += 2;
        for (const line of wrap(ctx, jam.description, tw, Math.max(1, Math.floor((y + h - pad - ty) / 16)))) {
            ctx.fillText(line, tx, ty);
            ty += 16;
        }
    }
    ctx.restore();
}

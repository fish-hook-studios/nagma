import { registerCanvasPlugin } from "../canvas/canvas-plugins";
import { sceneFocus } from "../canvas/hit-test";
import { worldToScreen } from "../engine/camera";
import { editor } from "../engine/store";
import type { Camera, NagmaDocument, SceneNode } from "../engine/types";
import { BREAKPOINT_GAP, bpData, bpFrames, breakpointsOf, pageData, PRIMARY_BP, rangeLabel, webData } from "./model";
import { isSiteDoc, site } from "./state";

// The site's canvas: a page's breakpoint frames sit in one grey webpage container whose header shows
// the page's name, a preview button and "+" to add a breakpoint. Each breakpoint frame is named
// above it with its width and range (Desktop marked as the primary one), and a press on the name
// selects the frame. Embeds (video, map, code), CMS lists and copies are
// labelled, since the canvas shows them as plain boxes.

interface Label {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

function labels(doc: NagmaDocument, camera: Camera): Label[] {
    const out: Label[] = [];
    const frames = bpFrames(doc, editor.get().pageId);
    for (const frame of Object.values(frames)) {
        if (!frame || (sceneFocus.id && sceneFocus.id !== frame.id)) continue;
        const at = worldToScreen(camera, frame.x, frame.y);
        const right = worldToScreen(camera, frame.x + frame.w, frame.y).x;
        out.push({ id: frame.id, x: at.x, y: at.y - 24, w: Math.max(60, right - at.x), h: 20 });
    }
    return out;
}

// The webpage container around the page's frames (screen space), with its header buttons.
interface Container {
    x: number;
    y: number;
    w: number;
    h: number;
    header: number;
    preview: { x: number; y: number; w: number; h: number };
    add: { x: number; y: number; w: number; h: number };
}

function container(doc: NagmaDocument, camera: Camera): Container | null {
    if (sceneFocus.id) return null;
    const frames = Object.values(bpFrames(doc, editor.get().pageId)).filter((f): f is SceneNode => Boolean(f));
    if (!frames.length) return null;
    const a = worldToScreen(camera, Math.min(...frames.map((f) => f.x)), Math.min(...frames.map((f) => f.y)));
    const b = worldToScreen(camera, Math.max(...frames.map((f) => f.x + f.w)), Math.max(...frames.map((f) => f.y + f.h)));
    const pad = 20;
    const header = 34;
    const x = a.x - pad;
    const y = a.y - 28 - header;
    // Wide enough for the last breakpoint's name and range above it.
    const last = frames.reduce((m, f) => (f.x > m.x ? f : m), frames[0] as SceneNode);
    const labelEnd = worldToScreen(camera, last.x, last.y).x + 190;
    const w = Math.max(220, Math.max(b.x, labelEnd) - a.x + pad * 2);
    const h = b.y - y + pad;
    const add = { x: x + w - 30, y: y + 6, w: 22, h: 22 };
    // ▶ (preview) before the page's name, "+" (add a breakpoint) at the header's right end.
    const preview = { x: x + 7, y: y + 6, w: 22, h: 22 };
    return { x, y, w, h, header, preview, add };
}

const within = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function embedLabel(node: SceneNode): string | null {
    const web = webData(node);
    if (web.embed?.kind === "video") return web.embed.url ? `Video: ${web.embed.url}` : "Video: add an address";
    if (web.embed?.kind === "map") return `Map: ${web.embed.query || "add a place"}`;
    if (web.embed?.kind === "code") return "Code embed (shown in Preview)";
    return null;
}

registerCanvasPlugin({
    name: "site",
    // Breakpoint frames get the overlay's header (name, width, range, Primary), not a second plain name.
    ownsLabel: (node) => isSiteDoc() && Boolean(bpData(node)),
    down(p) {
        if (!isSiteDoc() || p.button !== 0 || editor.get().tool !== "move") return false;
        const s = editor.get();
        const box = container(s.doc, s.camera);
        if (box && within(p.screen, box.add) && !s.readOnly) {
            site.set({ bpMenu: { x: box.add.x + box.add.w, y: box.add.y + box.add.h + 4 } });
            return true;
        }
        if (box && within(p.screen, box.preview)) {
            site.set({ inlinePreview: true });
            return true;
        }
        // The header strip selects the webpage itself.
        if (box && within(p.screen, { x: box.x, y: box.y, w: box.w, h: box.header })) {
            editor.set({ selection: [], editingTextId: null });
            site.set({ pageSelected: true });
            return true;
        }
        if (site.get().pageSelected) site.set({ pageSelected: false });
        for (const l of labels(s.doc, s.camera)) {
            if (p.screen.x >= l.x && p.screen.x <= l.x + Math.min(l.w, 260) && p.screen.y >= l.y && p.screen.y <= l.y + l.h) {
                editor.set({ selection: [l.id], editingTextId: null });
                return true;
            }
        }
        return false;
    },
    hover(p) {
        if (!isSiteDoc()) return undefined;
        const s = editor.get();
        const box = container(s.doc, s.camera);
        if (box && (within(p.screen, box.add) || within(p.screen, box.preview))) return "pointer";
        for (const l of labels(s.doc, s.camera)) if (p.screen.x >= l.x && p.screen.x <= l.x + Math.min(l.w, 260) && p.screen.y >= l.y && p.screen.y <= l.y + l.h) return "default";
        return undefined;
    },
    overlay(ctx, camera) {
        if (!isSiteDoc()) return;
        const s = editor.get();
        const doc = s.doc;
        ctx.font = "500 11px Inter, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        const box = container(doc, camera);
        if (box) {
            // Grey around the frames (they stay as they are), a header strip with the page's name.
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(box.x, box.y, box.w, box.h, 10);
            for (const frame of Object.values(bpFrames(doc, s.pageId))) {
                if (!frame) continue;
                const a = worldToScreen(camera, frame.x, frame.y);
                const b = worldToScreen(camera, frame.x + frame.w, frame.y + frame.h);
                ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
            }
            ctx.fillStyle = "rgba(128, 128, 128, 0.12)";
            ctx.fill("evenodd");
            // Selected, the webpage takes the selection colour.
            const chosen = site.get().pageSelected;
            ctx.strokeStyle = chosen ? getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#0D99FF" : "rgba(128, 128, 128, 0.28)";
            ctx.lineWidth = chosen ? 1.5 : 1;
            ctx.beginPath();
            ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 10);
            ctx.stroke();
            ctx.strokeStyle = "rgba(128, 128, 128, 0.28)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(box.x, box.y + box.header);
            ctx.lineTo(box.x + box.w, box.y + box.header);
            ctx.stroke();
            const page = doc.nodes[s.pageId];
            const data = pageData(page);
            ctx.font = "600 12px Inter, system-ui, sans-serif";
            ctx.fillStyle = "#6B6B6B";
            const name = `${page?.name ?? "Page"}${data && !data.notFound ? `  ${data.path}` : ""}`;
            ctx.fillText(name.length > 60 ? `${name.slice(0, 60)}…` : name, box.x + 36, box.y + box.header / 2);
            ctx.font = "500 11px Inter, system-ui, sans-serif";
            const button = (r: { x: number; y: number; w: number; h: number }) => {
                ctx.fillStyle = "rgba(128, 128, 128, 0.16)";
                ctx.beginPath();
                ctx.roundRect(r.x, r.y, r.w, r.h, 5);
                ctx.fill();
            };
            ctx.strokeStyle = "#8C8C8C";
            ctx.lineWidth = 1.3;
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(box.preview.x + 7.5, box.preview.y + 5.5);
            ctx.lineTo(box.preview.x + 16, box.preview.y + 11);
            ctx.lineTo(box.preview.x + 7.5, box.preview.y + 16.5);
            ctx.closePath();
            ctx.stroke();
            if (!s.readOnly) {
                button(box.add);
                ctx.strokeStyle = "#555555";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(box.add.x + 6, box.add.y + 11);
                ctx.lineTo(box.add.x + 16, box.add.y + 11);
                ctx.moveTo(box.add.x + 11, box.add.y + 6);
                ctx.lineTo(box.add.x + 11, box.add.y + 16);
                ctx.stroke();
            }
            ctx.restore();
        }
        const ranges = new Map(breakpointsOf(doc, s.pageId).map((b) => [b.id, b]));
        for (const l of labels(doc, camera)) {
            const frame = doc.nodes[l.id];
            const data = bpData(frame);
            if (!frame || !data) continue;
            const info = ranges.get(data.bp);
            const selected = s.selection.includes(frame.id);
            let x = l.x;
            // Names stay within their frame and the gap after it.
            ctx.save();
            ctx.beginPath();
            ctx.rect(l.x, l.y - 2, l.w + worldToScreen(camera, BREAKPOINT_GAP, 0).x - worldToScreen(camera, 0, 0).x - 12, l.h + 4);
            ctx.clip();
            ctx.fillStyle = selected ? "#4F46E5" : "#8A8A8A";
            ctx.fillText(frame.name, x, l.y + 10);
            x += ctx.measureText(frame.name).width + 6;
            ctx.fillStyle = "#A0A0A0";
            const size = `${Math.round(frame.w)}${info ? `  (${rangeLabel(info)})` : ""}`;
            ctx.fillText(size, x, l.y + 10);
            x += ctx.measureText(size).width + 8;
            if (data.bp === PRIMARY_BP) {
                const w = ctx.measureText("Primary").width + 10;
                ctx.fillStyle = "rgba(79, 70, 229, 0.14)";
                ctx.beginPath();
                ctx.roundRect(x, l.y + 2, w, 16, 4);
                ctx.fill();
                ctx.fillStyle = "#4F46E5";
                ctx.fillText("Primary", x + 5, l.y + 10.5);
            } else if ((data.ov?.length ?? 0) > 0 || frameHasOverrides(doc, frame.id)) {
                ctx.fillStyle = "#D97706";
                ctx.fillText("Has changes", x, l.y + 10);
            }
            ctx.restore();
        }
        // Embeds and lists.
        const page = doc.nodes[s.pageId];
        if (!page) return;
        const visit = (id: string) => {
            const node = doc.nodes[id];
            if (!node || !node.visible) return;
            const text = embedLabel(node) ?? (webData(node).list ? "Collection list" : null);
            if (text && (!sceneFocus.id || inside(doc, node.id, sceneFocus.id))) {
                const a = worldToScreen(camera, node.x, node.y);
                const b = worldToScreen(camera, node.x + node.w, node.y + node.h);
                if (b.x - a.x > 40 && b.y - a.y > 16) {
                    const embed = Boolean(webData(node).embed);
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
                    ctx.clip();
                    const label = text.length > 60 ? `${text.slice(0, 60)}…` : text;
                    const w = ctx.measureText(label).width + 12;
                    const cx = embed ? (a.x + b.x) / 2 - w / 2 : a.x + 4;
                    const cy = embed ? (a.y + b.y) / 2 - 10 : a.y + 4;
                    ctx.fillStyle = embed ? "rgba(16, 24, 40, 0.75)" : "rgba(79, 70, 229, 0.9)";
                    ctx.beginPath();
                    ctx.roundRect(cx, cy, w, 20, 5);
                    ctx.fill();
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillText(label, cx + 6, cy + 10.5);
                    ctx.restore();
                }
            }
            node.children.forEach(visit);
        };
        page.children.forEach(visit);
    },
});

function inside(doc: NagmaDocument, id: string, ancestor: string): boolean {
    let node: SceneNode | undefined = doc.nodes[id];
    while (node) {
        if (node.id === ancestor) return true;
        node = node.parentId ? doc.nodes[node.parentId] : undefined;
    }
    return false;
}

const overrideCache = new WeakMap<object, Map<string, boolean>>();
function frameHasOverrides(doc: NagmaDocument, frameId: string): boolean {
    let map = overrideCache.get(doc.nodes);
    if (!map) {
        map = new Map();
        overrideCache.set(doc.nodes, map);
    }
    const known = map.get(frameId);
    if (known !== undefined) return known;
    let found = false;
    const walk = (id: string) => {
        const n = doc.nodes[id];
        if (!n || found) return;
        if ((webData(n).ov?.length ?? 0) > 0) found = true;
        n.children.forEach(walk);
    };
    walk(frameId);
    map.set(frameId, found);
    return found;
}

import { drawNode } from "../canvas/render";
import { authHeaders } from "../engine/auth";
import { cssFor } from "../engine/dev-css";
import { exportSvg } from "../engine/export-svg";
import { getServerFiles, listFiles, loadFileDocument, refreshServerFiles } from "../engine/files";
import { imageDataUrl, preloadImages } from "../engine/image-store";
import { selectionBounds } from "../engine/nodes";
import { actionsOf } from "../engine/prototype";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import { prepareDocument } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";

// Design frames as references for Make: a picture and a structured description for the model, and
// (with no model) a static React app built from the frames as they are.

export interface DesignSource {
    // "local:<id>" for files in this browser, "server:<id>" for files on the sync server.
    key: string;
    name: string;
    updatedAt: number;
    thumb?: string | null;
}

// Design files you can take frames from: this browser's and the server's.
export async function designSources(): Promise<DesignSource[]> {
    await refreshServerFiles();
    const local = listFiles()
        .filter((f) => !f.trashed && !f.shared && (f.kind === "design" || f.kind === "docs"))
        .map((f) => ({ key: `local:${f.id}`, name: f.name, updatedAt: f.updatedAt, thumb: f.thumb ?? null }));
    const remote = getServerFiles()
        .filter((f) => !f.trashed && f.kind === "design")
        .map((f) => ({ key: `server:${f.id}`, name: f.name, updatedAt: f.updatedAt, thumb: f.thumb }));
    return [...local, ...remote].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDesign(key: string): Promise<NagmaDocument | null> {
    const [where, id] = key.split(":") as [string, string];
    if (where === "local") return loadFileDocument(id);
    const file = getServerFiles().find((f) => f.id === id);
    const link = listFiles().find((f) => f.shared === id)?.key ?? file?.keys?.edit ?? file?.keys?.view;
    const res = await fetch(`${httpBase()}/files/${encodeURIComponent(id)}/doc${link ? `?key=${encodeURIComponent(link)}` : ""}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const data = (await res.json()) as { doc?: NagmaDocument };
    return prepareDocument(data.doc ?? null);
}

// The top-level frames of every page (sections' frames too), the screens you'd build from.
export function framesOf(doc: NagmaDocument): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (ids: string[], depth: number) => {
        for (const id of ids) {
            const n = doc.nodes[id];
            if (!n || !n.visible || n.internal) continue;
            if (n.type === "page") visit(n.children, 0);
            else if (n.isSection && depth < 2) visit(n.children, depth + 1);
            else if (n.type === "frame" || n.type === "component" || n.type === "instance") out.push(n);
        }
    };
    visit(doc.roots, 0);
    return out;
}

// The frames selected in the last design file you had open, so "Current selection" can attach them.
let lastSelection: { fileId: string; fileName: string; doc: NagmaDocument; ids: string[] } | null = null;
editor.subscribe(() => {
    const s = editor.get();
    if (!s.fileId || s.doc.make || s.doc.board || s.doc.slides || s.doc.campaign || s.homeOpen) return;
    const ids = s.selection.map((id) => topFrame(s.doc, id)).filter((id): id is string => Boolean(id));
    const unique = [...new Set(ids)];
    if (unique.length) lastSelection = { fileId: s.fileId, fileName: s.doc.name, doc: s.doc, ids: unique };
    else if (lastSelection?.fileId === s.fileId && lastSelection.doc !== s.doc) lastSelection = { ...lastSelection, doc: s.doc, ids: lastSelection.ids.filter((id) => s.doc.nodes[id]) };
});
function topFrame(doc: NagmaDocument, id: string): string | null {
    let node = doc.nodes[id];
    while (node?.parentId && doc.nodes[node.parentId]?.type !== "page" && !doc.nodes[node.parentId]?.isSection) node = doc.nodes[node.parentId];
    return node && node.type !== "page" ? node.id : null;
}
export function selectionInDesign() {
    return lastSelection && lastSelection.ids.length ? lastSelection : null;
}

// The frame as a picture: PNG at up to `max` pixels on its long side.
export async function frameImage(doc: NagmaDocument, id: string, max = 1400): Promise<string> {
    await preloadImages(doc.images);
    const box = selectionBounds(doc, [id]);
    const node = doc.nodes[id];
    if (!box || !node) return "";
    const scale = Math.min(2, max / Math.max(box.w, box.h, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.translate(-box.x, -box.y);
    drawNode(ctx, doc, node, { editingTextId: null, pixelScale: scale });
    return canvas.toDataURL("image/png");
}

const hex = (n: SceneNode, key: "fills" | "strokes") =>
    n[key]
        .filter((p) => p.visible)
        .map((p) => (p.type === "solid" ? (p.opacity < 1 ? `${p.color} ${Math.round(p.opacity * 100)}%` : p.color) : p.type === "image" ? "image" : p.type))
        .join(", ") || undefined;

// The frame's layers as compact structured data: kind, name, box (relative to the frame), colours,
// text and type, auto layout, corner radius and component names. Long frames are cut off.
export function describeFrame(doc: NagmaDocument, id: string, limit = 30000): string {
    const root = doc.nodes[id];
    if (!root) return "";
    const origin = worldBounds(doc, root);
    let count = 0;
    const visit = (n: SceneNode, depth: number): Record<string, unknown> | null => {
        if (!n.visible || count > 600) return null;
        count++;
        const b = worldBounds(doc, n);
        const out: Record<string, unknown> = { type: n.type === "instance" || n.type === "component" ? "component" : n.type, name: n.name, x: Math.round(b.x - origin.x), y: Math.round(b.y - origin.y), w: Math.round(b.w), h: Math.round(b.h) };
        const fill = hex(n, "fills");
        if (fill) out[n.type === "text" ? "color" : "fill"] = fill;
        const stroke = hex(n, "strokes");
        if (stroke && n.strokeWidth) out.border = `${n.strokeWidth}px ${stroke}`;
        if (n.radius) out.radius = n.radius;
        if (n.opacity < 1) out.opacity = Math.round(n.opacity * 100) / 100;
        if (n.shadow || n.effects?.some((e) => e.visible && e.type === "drop-shadow")) out.shadow = true;
        if (n.type === "text") {
            out.text = (n.text ?? "").slice(0, 600);
            out.font = `${n.fontFamily ?? "Inter"} ${n.fontWeight ?? 400} ${n.fontSize ?? 16}px`;
            if (n.textAlign && n.textAlign !== "left") out.align = n.textAlign;
        }
        if (n.layout) out.layout = n.layout.grid ? { grid: n.layout.grid.columns, gap: n.layout.grid.columnGap, padding: n.layout.padding } : { direction: n.layout.direction, gap: n.layout.gap, padding: n.layout.padding, align: n.layout.counter, justify: n.layout.primary, wrap: n.layout.wrap || undefined };
        if (n.type === "instance" && n.componentId) out.component = doc.nodes[n.componentId]?.name ?? n.name;
        if (n.interactions?.length) {
            const go = n.interactions.flatMap((i) => actionsOf(i)).find((a) => a.type === "navigate" && a.target);
            if (go?.target) out.onClick = `go to "${doc.nodes[go.target]?.name ?? "screen"}"`;
        }
        const leaf = n.type === "vector" || n.type === "boolean" || n.type === "text";
        if (!leaf && depth < 12 && n.children.length) {
            const kids = n.children.map((c) => doc.nodes[c]).filter((c): c is SceneNode => Boolean(c)).map((c) => visit(c, depth + 1)).filter(Boolean);
            if (kids.length) out.children = kids;
        }
        return out;
    };
    const tree = visit(root, 0);
    const text = JSON.stringify(tree);
    return text.length > limit ? `${text.slice(0, limit)}… (cut off)` : text;
}

// ---- Frames to a static React app, without the model ----

const clsName = (name: string, i: number) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "layer"}-${i}`;
const jsxText = (text: string) =>
    text
        .split("\n")
        .map((line) => `{${JSON.stringify(line)}}`)
        .join("<br />");
const component = (name: string, i: number) => {
    const base = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    return /^[A-Z]/.test(base) ? base : `Screen${base || i + 1}`;
};

// Turns frames into a React app as they are: absolutely placed layers (auto layout stays flex),
// the frame's CSS from Inspect's generator, text as text, vectors as inline SVG pictures and image
// fills as data URLs. Click-to-navigate links between the frames become screen changes.
export async function framesToApp(doc: NagmaDocument, ids: string[], title: string): Promise<Record<string, string>> {
    await preloadImages(doc.images);
    const imageUrls = new Map<string, string>();
    const css: string[] = [`*, *::before, *::after { box-sizing: border-box; }`, `body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f4f4f5; }`, `p { margin: 0; }`, `.screen { position: relative; margin: 0 auto; overflow: hidden; }`, `.nav { display: flex; gap: 8px; justify-content: center; padding: 12px; font: 13px system-ui, sans-serif; }`, `.nav button { border: 1px solid #d4d4d8; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; }`, `.nav button[aria-current="true"] { background: #18181b; color: #fff; border-color: #18181b; }`];
    const screens: { id: string; name: string; fn: string; jsx: string }[] = [];
    let counter = 0;
    const screenIds = new Set(ids);
    const resolveImages = async (text: string): Promise<string> => {
        const refs = [...text.matchAll(/<image ([^>]+)>/g)].map((m) => m[1] as string);
        for (const ref of refs) {
            if (!imageUrls.has(ref)) imageUrls.set(ref, (await imageDataUrl(doc.images, ref)) ?? "");
        }
        return text.replace(/url\(<image ([^>]+)>\)/g, (_, ref: string) => `url("${imageUrls.get(ref) ?? ""}")`);
    };
    const render = async (n: SceneNode, parent: SceneNode | null, indent: string): Promise<string> => {
        if (!n.visible) return "";
        const cls = clsName(n.name, counter++);
        const lines = (await resolveImages(cssFor(n, doc.images, doc))).split("\n").filter(Boolean);
        const inFlow = parent?.layout && n.positioning !== "absolute";
        if (parent && !inFlow) {
            const pb = worldBounds(doc, parent);
            const b = worldBounds(doc, n);
            lines.unshift("position: absolute;", `left: ${Math.round(b.x - pb.x)}px;`, `top: ${Math.round(b.y - pb.y)}px;`);
            if (n.rotation) lines.push(`transform-origin: 0 0;`);
        } else if (!parent) lines.unshift("position: relative;");
        if (!n.layout && n.children.length && n.type !== "vector" && n.type !== "boolean") lines.push("position: relative;");
        if (n.type === "text") lines.push("white-space: pre-wrap;");
        css.push(`.${cls} {\n${lines.map((l) => `    ${l}`).join("\n")}\n}`);
        const go = n.interactions?.flatMap((i) => (i.trigger === "click" ? actionsOf(i) : [])).find((a) => (a.type === "navigate" && a.target && screenIds.has(a.target)) || a.type === "back" || (a.type === "url" && a.url));
        const click = go ? (go.type === "navigate" ? ` onClick={() => go(${JSON.stringify(go.target)})}` : go.type === "back" ? ` onClick={back}` : ` onClick={() => window.open(${JSON.stringify(go.url)}, "_blank")}`) : "";
        const style = click ? ` style={{ cursor: "pointer" }}` : "";
        if (n.type === "text") return `${indent}<p className="${cls}"${click}${style}>${jsxText(n.text ?? "")}</p>`;
        if (n.type === "vector" || n.type === "boolean" || (n.type !== "frame" && n.type !== "group" && n.type !== "component" && n.type !== "instance" && n.type !== "rect" && n.type !== "ellipse")) {
            const svg = exportSvg(doc, n.id);
            if (svg) return `${indent}<img className="${cls}" alt=${JSON.stringify(n.altText ?? "")} src=${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)}${click}${style} />`;
        }
        const kids: string[] = [];
        for (const id of n.children) {
            const child = doc.nodes[id];
            if (child) kids.push(await render(child, n, `${indent}    `));
        }
        const inner = kids.filter(Boolean);
        const tag = click ? "button" : "div";
        const reset = click ? ` style={{ cursor: "pointer", border: "none", padding: 0, font: "inherit", textAlign: "inherit" }}` : "";
        const label = n.altText ? ` aria-label=${JSON.stringify(n.altText)}` : "";
        return inner.length ? `${indent}<${tag} className="${cls}"${label}${click}${reset}>\n${inner.join("\n")}\n${indent}</${tag}>` : `${indent}<${tag} className="${cls}"${label}${click}${reset} />`;
    };
    for (const [i, id] of ids.entries()) {
        const frame = doc.nodes[id];
        if (!frame) continue;
        const jsx = await render(frame, null, "        ");
        // The screen's outer box is centred; its own size is kept.
        screens.push({ id, name: frame.name, fn: component(frame.name, i), jsx: jsx.replace(/className="([^"]+)"/, 'className="screen $1"') });
    }
    const unique = new Set<string>();
    for (const s of screens) {
        let fn = s.fn;
        let n = 2;
        while (unique.has(fn)) fn = `${s.fn}${n++}`;
        unique.add(fn);
        s.fn = fn;
    }
    const app = [
        `import { useState, type ReactNode } from "react";`,
        `import "./App.css";`,
        ``,
        `// Built from the design ${screens.length > 1 ? "frames" : "frame"} as ${screens.length > 1 ? "they are" : "it is"}. Ask for changes in the chat to make it interactive.`,
        `type Go = { go: (screen: string) => void; back: () => void };`,
        ``,
        ...screens.flatMap((s) => [`function ${s.fn}({ go, back }: Go) {`, `    void go;`, `    void back;`, `    return (`, s.jsx, `    );`, `}`, ``]),
        `const SCREENS: { id: string; name: string; view: (props: Go) => ReactNode }[] = [`,
        ...screens.map((s) => `    { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, view: ${s.fn} },`),
        `];`,
        ``,
        `export default function App() {`,
        `    const [history, setHistory] = useState<string[]>([SCREENS[0]?.id ?? ""]);`,
        `    const current = SCREENS.find((s) => s.id === history[history.length - 1]) ?? SCREENS[0];`,
        `    const go = (id: string) => setHistory((h) => [...h, id]);`,
        `    const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));`,
        `    return (`,
        `        <>`,
        ...(screens.length > 1
            ? [
                  `            <nav className="nav" aria-label="Screens">`,
                  `                {SCREENS.map((s) => (`,
                  `                    <button key={s.id} type="button" aria-current={s.id === current?.id} onClick={() => go(s.id)}>`,
                  `                        {s.name}`,
                  `                    </button>`,
                  `                ))}`,
                  `            </nav>`,
              ]
            : []),
        `            {current && <current.view go={go} back={back} />}`,
        `        </>`,
        `    );`,
        `}`,
        ``,
    ].join("\n");
    const pkg = { name: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app", private: true, type: "module", dependencies: {} };
    return {
        "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${title.replace(/[<&]/g, "")}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
        "src/main.tsx": `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(\n    <StrictMode>\n        <App />\n    </StrictMode>,\n);\n`,
        "src/App.tsx": app,
        "src/App.css": `${css.join("\n\n")}\n`,
        "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    };
}

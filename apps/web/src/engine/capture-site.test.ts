// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { describe, expect, it } from "vitest";
import { bpFrames, breakpointsOf, mirrorIdFor, webData } from "../site/model";
import type { Capture, CaptureBox, CaptureNode, CaptureStyle } from "./capture-format";
import { captureToDocument } from "./capture-import";
import { captureToSite } from "./capture-site";
import { applyCommand } from "./commands";
import type { SceneNode } from "./types";

// A capture taken at three widths: side by side as frames, or as a site with a breakpoint per width
// whose layers follow the widest one's.

function style(over: Partial<CaptureStyle> = {}): CaptureStyle {
    return { display: "block", position: "static", padding: [0, 0, 0, 0], borderWidths: [0, 0, 0, 0], borderColors: ["", "", "", ""], borderStyles: ["none", "none", "none", "none"], radii: [0, 0, 0, 0], backgroundColor: "rgba(0, 0, 0, 0)", backgrounds: [], shadows: [], opacity: 1, overflowX: "visible", overflowY: "visible", zIndex: null, ...over };
}
const box = (x: number, y: number, w: number, h: number): CaptureBox => ({ x, y, w, h });
const el = (tag: string, b: CaptureBox, path: string, over: Partial<CaptureStyle> = {}, children: CaptureNode[] = [], name = tag): CaptureNode => ({ tag, name, box: b, style: style(over), path, children });
const text = (content: string, b: CaptureBox, path: string, size = 16): CaptureNode => ({
    tag: "#text",
    name: content,
    box: b,
    path,
    style: style({ display: "inline" }),
    text: { content, style: { family: "Inter", stack: "Inter", size, weight: 400, italic: false, lineHeight: b.h, letterSpacing: 0, color: "rgb(16, 24, 40)", align: "left", decoration: "none", transform: "none", whiteSpace: "normal", direction: "ltr" }, runs: [], lines: 1 },
    children: [],
});

// The page at one width: a header bar with a logo box and (wide enough) a sign-in button, a
// heading, and at phone width a menu button instead of the sign-in.
function pageAt(w: number): CaptureNode {
    const narrow = w < 500;
    const header = el("header", box(0, 0, w, 64), "body>header:0", { backgroundColor: "rgb(255, 255, 255)" }, [
        el("div", box(24, 16, 32, 32), "body>header:0>div:0", { backgroundColor: "rgb(79, 70, 229)" }, [], "Logo"),
        narrow ? el("button", box(w - 56, 16, 32, 32), "body>header:0>button:1", { backgroundColor: "rgb(242, 244, 247)" }, [], "Menu") : el("a", box(w - 124, 16, 100, 32), "body>header:0>a:0", { backgroundColor: "rgb(16, 24, 40)" }, [], "Sign in"),
    ], "Header");
    const heading = text("Plan together", box(24, 96, narrow ? 200 : 400, narrow ? 32 : 48), "body>h1:0>#text:0", narrow ? 28 : 40);
    return el("body", box(0, 0, w, 600), "body", { backgroundColor: "rgb(250, 250, 250)" }, [header, heading], "Body");
}

function capture(): Capture {
    const at = (label: string, w: number) => ({ label, width: w, viewport: { w, h: 600 }, scroll: { w, h: 600 }, background: "rgb(250, 250, 250)", root: pageAt(w) });
    const main = at("Desktop", 1280);
    return { format: "nagma-capture", version: 1, title: "Lumen", url: "https://lumen.test/", capturedAt: "2026-10-23T00:00:00.000Z", viewport: main.viewport, scroll: main.scroll, dpr: 1, background: main.background, root: main.root, assets: {}, fonts: [], label: "Desktop", breakpoints: [at("Tablet", 800), at("Phone", 375)] };
}

const byPath = (nodes: Record<string, SceneNode>, path: string, inside: string) =>
    Object.values(nodes).filter((n) => n.pluginData?.["capture:path"] === path && within(nodes, n.id, inside));
function within(nodes: Record<string, SceneNode>, id: string, ancestor: string): boolean {
    let n: SceneNode | undefined = nodes[id];
    while (n) {
        if (n.id === ancestor) return true;
        n = n.parentId ? nodes[n.parentId] : undefined;
    }
    return false;
}

describe("a capture at several widths, side by side", () => {
    it("makes a frame per width, widest first, named with their widths, in a row", () => {
        const { doc, frameIds } = captureToDocument(capture());
        const frames = frameIds.map((id) => doc.nodes[id] as SceneNode);
        expect(frames.map((f) => [f.name, f.w, f.x])).toEqual([
            ["Lumen 1280", 1280, 0],
            ["Lumen 800", 800, 1440],
            ["Lumen 375", 375, 2400],
        ]);
        // Each frame holds its own width's layers, moved with it.
        const logo = byPath(doc.nodes, "body>header:0>div:0", frames[2]?.id as string)[0] as SceneNode;
        expect([logo.x, logo.y]).toEqual([2424, 16]);
        expect(byPath(doc.nodes, "body>header:0>button:1", frames[2]?.id as string)).toHaveLength(1);
    });
});

describe("a capture at several widths, as a site", () => {
    it("makes the Home page with a breakpoint per width, widest the primary", () => {
        const { doc, pageId } = captureToSite(capture());
        expect(doc.site).toBe(true);
        expect(breakpointsOf(doc, pageId).map((b) => [b.id, b.label, b.width])).toEqual([
            ["desktop", "Desktop", 1280],
            ["tablet", "Tablet", 800],
            ["mobile", "Phone", 375],
        ]);
    });

    it("links each narrower width's layers to the primary's, with what differs as overrides", () => {
        const { doc, pageId } = captureToSite(capture());
        const frames = bpFrames(doc, pageId);
        const heading = byPath(doc.nodes, "body>h1:0>#text:0", frames.desktop?.id as string)[0] as SceneNode;
        const tablet = doc.nodes[mirrorIdFor(heading.id, "tablet")] as SceneNode;
        const phone = doc.nodes[mirrorIdFor(heading.id, "mobile")] as SceneNode;
        expect(webData(tablet).src).toBe(heading.id);
        expect(tablet.fontSize).toBe(40);
        expect(phone.fontSize).toBe(28);
        expect(webData(phone).ov).toContain("fontSize");
        expect(webData(tablet).ov ?? []).not.toContain("fontSize");
        // The primary's text changes reach both, the phone's own size stays.
        const edited = applyCommand(doc, { type: "node.update", id: heading.id, patch: { text: "Plan it together", fontSize: 44 } });
        expect(edited.nodes[tablet.id]?.text).toBe("Plan it together");
        expect(edited.nodes[phone.id]?.text).toBe("Plan it together");
        expect(edited.nodes[tablet.id]?.fontSize).toBe(44);
        expect(edited.nodes[phone.id]?.fontSize).toBe(28);
    });

    it("hides what a width doesn't show, and keeps what only it has as its own", () => {
        const { doc, pageId } = captureToSite(capture());
        const frames = bpFrames(doc, pageId);
        const signIn = byPath(doc.nodes, "body>header:0>a:0", frames.desktop?.id as string)[0] as SceneNode;
        expect(doc.nodes[mirrorIdFor(signIn.id, "tablet")]?.visible).toBe(true);
        expect(doc.nodes[mirrorIdFor(signIn.id, "mobile")]?.visible).toBe(false);
        const menu = byPath(doc.nodes, "body>header:0>button:1", frames.mobile?.id as string);
        expect(menu).toHaveLength(1);
        expect(webData(menu[0]).src).toBeUndefined();
        expect(byPath(doc.nodes, "body>header:0>button:1", frames.desktop?.id as string)).toHaveLength(0);
    });

    it("sets custom widths through the breakpoint helpers", () => {
        const c = capture();
        c.viewport = { w: 1440, h: 600 };
        c.breakpoints = [{ ...(c.breakpoints?.[1] as NonNullable<Capture["breakpoints"]>[number]), label: "Phone", width: 390, viewport: { w: 390, h: 600 }, root: pageAt(390) }];
        c.root = pageAt(1440);
        const { doc, pageId } = captureToSite(c);
        expect(breakpointsOf(doc, pageId).map((b) => [b.label, b.width, b.min])).toEqual([
            ["Desktop", 1440, 1024],
            ["Phone", 390, 0],
        ]);
    });
});

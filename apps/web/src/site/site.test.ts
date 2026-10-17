import "../test/prod-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand } from "../engine/commands";
import { makeNode } from "../engine/nodes";
import { activePage } from "../engine/page";
import { imagePaint, solid } from "../engine/paint";
import { editor, prepareDocument } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { expectConsistentTree } from "../test/prod-fixtures";
import { buildSite, outputPages, safeUrl, siteFiles } from "./html";
import { addBreakpointCommands, addPageCommands, bpFrames, breakpointProblem, breakpointsOf, createSiteDocument, deleteBreakpointCommand, mirrorOf, pageOverflow, primaryOf, sitePages, updateBreakpointCommand, webData } from "./model";
import type { SiteNodeData } from "./types";

// ---- A site with a Home page: desktop, tablet and mobile frames ----

function site() {
    const doc = createSiteDocument("Acme");
    const home = sitePages(doc)[0] as SceneNode;
    activePage.id = home.id;
    const frames = bpFrames(doc, home.id);
    return { doc, home, desktop: frames.desktop as SceneNode, tablet: frames.tablet as SceneNode, mobile: frames.mobile as SceneNode };
}

const ed = () => editor.get().doc;
const node = (id: string) => ed().nodes[id] as SceneNode;
const run = (cmd: Command) => editor.execute(cmd);

function addText(parentId: string, text: string, extra: Partial<SceneNode> = {}): SceneNode {
    const n = makeNode(ed(), "text", { x: 0, y: 0, w: 400, h: 40 }, parentId, { name: text.slice(0, 20), text, fontSize: 32, sizing: { h: "fixed", v: "hug" }, ...extra });
    run({ type: "node.create", node: n });
    return node(n.id);
}

describe("site breakpoints: desktop edits flow to tablet and mobile unless overridden", () => {
    let s: ReturnType<typeof site>;
    beforeEach(() => {
        s = site();
        editor.loadDocument(s.doc, null);
        activePage.id = s.home.id;
    });

    it("a new site has three breakpoints with the expected ranges", () => {
        expect(breakpointsOf(ed(), s.home.id).map((b) => [b.id, b.width, b.min, b.max])).toEqual([
            ["desktop", 1280, 1024, null],
            ["tablet", 800, 800, 1023],
            ["mobile", 375, 0, 799],
        ]);
        expect([s.tablet.id, s.mobile.id]).toEqual([`${s.desktop.id}@tablet`, `${s.desktop.id}@mobile`]);
    });

    it("a layer added on desktop gets a copy on each breakpoint, in the same place in the stack", () => {
        const a = addText(s.desktop.id, "First");
        const b = addText(s.desktop.id, "Second");
        for (const bp of ["tablet", "mobile"] as const) {
            const frame = node(bpFrames(ed(), s.home.id)[bp]?.id as string);
            expect(frame.children).toEqual([`${a.id}@${bp}`, `${b.id}@${bp}`]);
            expect(node(`${a.id}@${bp}`)).toMatchObject({ text: "First", fontSize: 32, parentId: frame.id });
            expect(webData(node(`${a.id}@${bp}`)).src).toBe(a.id);
            expect(primaryOf(ed(), `${a.id}@${bp}`)).toBe(a.id);
            expect(mirrorOf(ed(), a.id, bp)).toBe(`${a.id}@${bp}`);
        }
        expectConsistentTree(ed());
    });

    it("desktop edits reach both copies; a tablet override stays and also reaches mobile", () => {
        const a = addText(s.desktop.id, "Hello");
        run({ type: "node.update", id: a.id, patch: { text: "Hi there", fontSize: 48 } });
        expect([node(`${a.id}@tablet`).text, node(`${a.id}@mobile`).text]).toEqual(["Hi there", "Hi there"]);
        expect([node(`${a.id}@tablet`).fontSize, node(`${a.id}@mobile`).fontSize]).toEqual([48, 48]);

        // Tablet changes its size: recorded as an override, passed on to mobile.
        run({ type: "node.update", id: `${a.id}@tablet`, patch: { fontSize: 24 } });
        expect(webData(node(`${a.id}@tablet`)).ov).toEqual(["fontSize"]);
        expect(node(`${a.id}@mobile`).fontSize).toBe(24);

        // Desktop changes size and text again: tablet keeps its size, takes the text.
        run({ type: "node.update", id: a.id, patch: { fontSize: 64, text: "Final" } });
        expect([node(a.id).fontSize, node(`${a.id}@tablet`).fontSize, node(`${a.id}@mobile`).fontSize]).toEqual([64, 24, 24]);
        expect([node(`${a.id}@tablet`).text, node(`${a.id}@mobile`).text]).toEqual(["Final", "Final"]);

        // Mobile overrides colour; tablet's later colour change doesn't reach it.
        run({ type: "node.update", id: `${a.id}@mobile`, patch: { fills: [solid("#FF0000")] } });
        run({ type: "node.update", id: `${a.id}@tablet`, patch: { fills: [solid("#00FF00")] } });
        expect(node(`${a.id}@mobile`).fills[0]).toMatchObject({ color: "#FF0000" });
        expect(node(a.id).fills[0]).not.toMatchObject({ color: "#00FF00" });
        expectConsistentTree(ed());
    });

    it("undo of a desktop edit also restores the copies", () => {
        const a = addText(s.desktop.id, "Hello");
        run({ type: "node.update", id: a.id, patch: { text: "Changed" } });
        editor.undo();
        expect([node(a.id).text, node(`${a.id}@tablet`).text, node(`${a.id}@mobile`).text]).toEqual(["Hello", "Hello", "Hello"]);
        editor.undo();
        expect(ed().nodes[a.id]).toBeUndefined();
        expect(ed().nodes[`${a.id}@tablet`]).toBeUndefined();
        expect(ed().nodes[`${a.id}@mobile`]).toBeUndefined();
        editor.redo();
        expect(node(`${a.id}@mobile`).text).toBe("Hello");
    });

    it("deleting a copy hides it on that breakpoint only; deleting the desktop layer removes all", () => {
        const a = addText(s.desktop.id, "Promo");
        run({ type: "node.delete", ids: [`${a.id}@mobile`] });
        expect(node(`${a.id}@mobile`).visible).toBe(false);
        expect(webData(node(`${a.id}@mobile`)).ov).toContain("visible");
        expect([node(a.id).visible, node(`${a.id}@tablet`).visible]).toEqual([true, true]);
        // Desktop's later visibility change doesn't show it again on mobile.
        run({ type: "node.update", id: a.id, patch: { visible: false } });
        run({ type: "node.update", id: a.id, patch: { visible: true } });
        expect(node(`${a.id}@mobile`).visible).toBe(false);

        run({ type: "node.delete", ids: [a.id] });
        expect([a.id, `${a.id}@tablet`, `${a.id}@mobile`].map((id) => ed().nodes[id])).toEqual([undefined, undefined, undefined]);
        expect(node(s.tablet.id).children).toEqual([]);
        expectConsistentTree(ed());
    });

    it("layers added on a breakpoint frame belong to it alone", () => {
        const only = addText(s.mobile.id, "Mobile only");
        expect(node(s.desktop.id).children).toEqual([]);
        expect(node(s.tablet.id).children).toEqual([]);
        expect(node(s.mobile.id).children).toEqual([only.id]);
    });

    it("nested layers copy with their parents, children in order", () => {
        const box = makeNode(ed(), "frame", { x: 0, y: 0, w: 600, h: 200 }, s.desktop.id, { name: "Card", layout: { direction: "vertical", gap: 8, padding: [8, 8, 8, 8], primary: "start", counter: "start" } });
        run({ type: "node.create", node: box });
        const t1 = addText(box.id, "One");
        const t2 = addText(box.id, "Two");
        expect(node(`${box.id}@tablet`).children).toEqual([`${t1.id}@tablet`, `${t2.id}@tablet`]);
        expect(node(`${t1.id}@mobile`).parentId).toBe(`${box.id}@mobile`);
        // Reordering on desktop reorders the copies.
        run({ type: "node.reparent", id: t2.id, parentId: box.id, index: 0 });
        expect(node(`${box.id}@tablet`).children).toEqual([`${t2.id}@tablet`, `${t1.id}@tablet`]);
        expect(node(`${box.id}@mobile`).children).toEqual([`${t2.id}@mobile`, `${t1.id}@mobile`]);
        // Moving a layer out to the frame moves the copies too.
        run({ type: "node.reparent", id: t1.id, parentId: s.desktop.id });
        expect(node(`${t1.id}@tablet`).parentId).toBe(s.tablet.id);
        expect(node(`${box.id}@tablet`).children).toEqual([`${t2.id}@tablet`]);
        expectConsistentTree(ed());
    });

    it("breakpoint add / update / delete with validation", () => {
        expect(breakpointProblem(ed(), s.home.id, 800)).toMatch(/already starts at 800/);
        expect(breakpointProblem(ed(), s.home.id, 2000)).toMatch(/start below Desktop/);
        expect(breakpointProblem(ed(), s.home.id, -1)).toMatch(/between 0 and 10000/);
        expect(breakpointProblem(ed(), s.home.id, Number.NaN)).toMatch(/between 0 and 10000/);
        // Regression: the primary's start was checked against the second-widest breakpoint, so
        // desktop could start below tablet (500 < 800) and collapse tablet's range.
        expect(breakpointProblem(ed(), s.home.id, 500, "desktop")).toMatch(/must start above Tablet \(800\)/);
        expect(breakpointProblem(ed(), s.home.id, 800, "desktop")).toMatch(/must start above/);
        expect(breakpointProblem(ed(), s.home.id, 900, "desktop")).toBeNull();
        const a = addText(s.desktop.id, "Hello");
        const added = addBreakpointCommands(ed(), s.home.id, { label: "Large phone", width: 430, min: 430 });
        expect("error" in added).toBe(false);
        if ("error" in added) return;
        run({ type: "batch", commands: added.commands });
        const list = breakpointsOf(ed(), s.home.id);
        expect(list.map((b) => [b.id, b.min, b.max])).toEqual([
            ["desktop", 1024, null],
            ["tablet", 800, 1023],
            ["large-phone", 430, 799],
            ["mobile", 0, 429],
        ]);
        // The new breakpoint is filled in from the wider one.
        expect(node(`${a.id}@large-phone`).text).toBe("Hello");
        expect(updateBreakpointCommand(ed(), s.home.id, "large-phone", { min: 800 })).toEqual({ error: expect.stringMatching(/already starts/) });
        expect(updateBreakpointCommand(ed(), s.home.id, "desktop", { min: 500 })).toEqual({ error: expect.stringMatching(/must start above/) });
        expect(updateBreakpointCommand(ed(), s.home.id, "nope", { label: "x" })).toBeNull();
        expect(deleteBreakpointCommand(ed(), s.home.id, "desktop")).toBeNull();
        run(deleteBreakpointCommand(ed(), s.home.id, "large-phone") as Command);
        expect(breakpointsOf(ed(), s.home.id).map((b) => b.id)).toEqual(["desktop", "tablet", "mobile"]);
        expect(ed().nodes[`${a.id}@large-phone`]).toBeUndefined();
        expectConsistentTree(ed());
    });

    it("a site document survives save and reload", () => {
        addText(s.desktop.id, "Saved");
        const saved = JSON.parse(JSON.stringify(ed())) as NagmaDocument;
        expect(prepareDocument(JSON.parse(JSON.stringify(ed())) as NagmaDocument)).toEqual(saved);
    });
});

// ---- HTML export ----

const VOID = new Set(["meta", "link", "img", "br", "hr", "input", "source", "area", "base", "col", "embed", "track", "wbr"]);

// Tags open and close in order (void elements excepted); scripts and styles skipped as text.
function unbalanced(html: string): string[] {
    const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<!doctype[^>]*>/i, "");
    const stack: string[] = [];
    const problems: string[] = [];
    for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
        const [, close, rawTag] = m;
        const tag = (rawTag as string).toLowerCase();
        if (VOID.has(tag)) continue;
        if (!close) stack.push(tag);
        else if (stack.at(-1) === tag) stack.pop();
        else problems.push(`</${tag}> closes <${stack.at(-1)}>`);
    }
    return [...problems, ...stack.map((t) => `<${t}> never closed`)];
}

describe("site HTML export", () => {
    beforeEach(() => {
        // Images are data URLs; fetch is stubbed in tests, so read them here.
        vi.stubGlobal("fetch", async (url: string) => {
            const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(url);
            if (!m) throw new TypeError("fetch is disabled in tests");
            const bytes = m[2] ? Uint8Array.from(Buffer.from(m[3] as string, "base64")) : new TextEncoder().encode(decodeURIComponent(m[3] as string));
            const blob = new Blob([bytes], { type: m[1] });
            return { ok: true, status: 200, blob: async () => blob };
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal("fetch", async () => {
            throw new TypeError("fetch is disabled in tests");
        });
    });

    function exportable() {
        const s = site();
        let doc: NagmaDocument = { ...s.doc, images: { pic: "data:image/png;base64,iVBORw0KGgo=" } };
        const put = (n: SceneNode) => {
            doc = applyCommand(doc, { type: "node.create", node: n });
            return n;
        };
        const title = put(makeNode(doc, "text", { x: 0, y: 0, w: 600, h: 60 }, s.desktop.id, { name: "Title", text: `<script>alert("x")</script> Tom & "Jerry" 'quotes'`, fontSize: 64, sizing: { h: "fixed", v: "hug" }, site: { tag: "h1" } as SiteNodeData }));
        const link = put(makeNode(doc, "text", { x: 0, y: 0, w: 200, h: 30 }, s.desktop.id, { name: "Docs", text: "Read docs", sizing: { h: "fixed", v: "hug" }, site: { link: { kind: "url", url: "docs.example.com/start", newTab: true } } as SiteNodeData }));
        const evil = put(makeNode(doc, "text", { x: 0, y: 0, w: 200, h: 30 }, s.desktop.id, { name: "Evil", text: "Click", sizing: { h: "fixed", v: "hug" }, site: { link: { kind: "url", url: "javascript:alert(1)" } } as SiteNodeData }));
        const img = put(makeNode(doc, "rect", { x: 0, y: 0, w: 320, h: 200 }, s.desktop.id, { name: "Hero", altText: `Hero "image" <b>`, fills: [imagePaint("pic", "fill")], sizing: { h: "fixed", v: "fixed" } }));
        // Tablet and mobile change the title's size.
        doc = applyCommand(doc, { type: "node.update", id: `${title.id}@tablet`, patch: { fontSize: 48 } });
        doc = applyCommand(doc, { type: "node.update", id: `${title.id}@mobile`, patch: { fontSize: 32 } });
        // A second page linked from the home page.
        const about = addPageCommands(doc, "About us", { path: "/about" });
        doc = applyCommand(doc, { type: "batch", commands: about.commands });
        const aboutLink = put(makeNode(doc, "text", { x: 0, y: 0, w: 200, h: 30 }, s.desktop.id, { name: "About", text: "About", sizing: { h: "fixed", v: "hug" }, site: { link: { kind: "page", pageId: about.pageId } } as SiteNodeData }));
        return { ...s, doc, title, link, evil, img, aboutLink, aboutId: about.pageId };
    }

    it("builds one well-formed page per site page with escaped text and safe links", async () => {
        const x = exportable();
        expect(outputPages(x.doc).map((p) => [p.path, p.file, p.depth])).toEqual([
            ["/", "index.html", 0],
            ["/about", "about/index.html", 1],
        ]);
        const build = await buildSite(x.doc, "publish");
        expect(build.warnings).toEqual([]);
        expect(build.pages.map((p) => [p.path, p.file, p.title])).toEqual([
            ["/", "index.html", "Acme"],
            ["/about", "about/index.html", "About us | Acme"],
        ]);
        const home = build.pages[0]?.html as string;
        expect(home.startsWith("<!doctype html>")).toBe(true);
        expect(unbalanced(home)).toEqual([]);
        expect(unbalanced(build.pages[1]?.html as string)).toEqual([]);
        // No raw user markup.
        expect(home).not.toContain("<script>alert");
        expect(home).toContain("&lt;script&gt;alert(\"x\")&lt;/script&gt; Tom &amp; \"Jerry\" 'quotes'");
        expect(home).not.toContain("javascript:");

        const dom = new DOMParser().parseFromString(home, "text/html");
        expect(dom.querySelector("h1")?.textContent).toBe(`<script>alert("x")</script> Tom & "Jerry" 'quotes'`);
        const anchors = [...dom.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]);
        expect(anchors).toEqual(
            expect.arrayContaining([
                ["Read docs", "https://docs.example.com/start", "_blank"],
                ["Click", "#", null],
                ["About", "./about/", null],
            ]),
        );
        const img = dom.querySelector("img");
        expect(img?.getAttribute("src")).toMatch(/^\.\/assets\/pic\.png$/);
        expect(img?.getAttribute("alt")).toBe(`Hero "image" <b>`);
        expect([img?.getAttribute("width"), img?.getAttribute("height")]).toEqual(["320", "200"]);
        expect([...build.assets.keys()]).toEqual(["assets/pic.png"]);
        expect(build.assets.get("assets/pic.png")?.type).toBe("image/png");
        // The about page links back up a level.
        const about = new DOMParser().parseFromString(build.pages[1]?.html as string, "text/html");
        expect(about.documentElement.getAttribute("lang")).toBe("en");
        const files = await siteFiles(build);
        expect(files.map((f) => f.path)).toEqual(["index.html", "about/index.html", "assets/pic.png"]);
    });

    it("a layer's scroll behaviour becomes its overflow", async () => {
        const x = exportable();
        const doc = applyCommand(x.doc, { type: "node.update", id: x.img.id, patch: { site: { overflow: "y" } as SiteNodeData } });
        const html = (await buildSite(doc, "publish")).pages[0]?.html as string;
        const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
        const cls = `.n-${x.img.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        expect(css).toMatch(new RegExp(`${cls.replace(/[.]/g, "\\.")}\\{[^}]*overflow:hidden auto`));
    });

    it("a new page scrolls both ways; a page from before keeps scrolling down only", async () => {
        const x = exportable();
        const desktop = x.doc.nodes[primaryOf(x.doc, x.img.parentId as string)] as SceneNode;
        expect(pageOverflow(x.doc, desktop.id)).toBe("both");
        const body = async (doc: NagmaDocument) => /body\.[^{]+\{[^}]*\}/.exec(/<style>([\s\S]*?)<\/style>/.exec((await buildSite(doc, "publish")).pages[0]?.html as string)?.[1] ?? "")?.[0] ?? "";
        expect(await body(x.doc)).toContain("overflow-x:auto");
        const { overflow: _drop, ...old } = desktop.site as { overflow?: string };
        const before = applyCommand(x.doc, { type: "node.update", id: desktop.id, patch: { site: old as SceneNode["site"] } });
        expect(pageOverflow(before, desktop.id)).toBe("y");
        expect(await body(before)).not.toContain("overflow-x:auto");
    });

    it("tablet and mobile differences become media queries over their ranges", async () => {
        const x = exportable();
        const html = (await buildSite(x.doc, "publish")).pages[0]?.html as string;
        const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
        const cls = `.n-${x.title.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        expect(css).toContain(`${cls}{`);
        expect(css).toMatch(new RegExp(`${cls.replace(/[.]/g, "\\.")}\\{[^}]*font-size:64px`));
        const tablet = /@media \(min-width:800px\) and \(max-width:1023\.98px\)\{([\s\S]*?)\}\}/.exec(css)?.[1] ?? "";
        const mobile = /@media \(max-width:799\.98px\)\{([\s\S]*?)\}\}/.exec(css)?.[1] ?? "";
        expect(tablet).toContain("font-size:48px");
        expect(mobile).toContain("font-size:32px");
        // Only what differs: the link (same on every breakpoint) has no media rule.
        const linkCls = `n-${x.link.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        expect(tablet).not.toContain(linkCls);
        // Braces balance in the stylesheet.
        expect([...css].filter((c) => c === "{").length).toBe([...css].filter((c) => c === "}").length);
    });

    it("preview mode inlines images as data and links pages for the preview runtime", async () => {
        const x = exportable();
        const build = await buildSite(x.doc, "preview");
        expect(build.assets.size).toBe(0);
        const dom = new DOMParser().parseFromString(build.pages[0]?.html as string, "text/html");
        expect(dom.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
        expect(dom.querySelector('a[data-to="/about"]')).not.toBeNull();
    });

    it("a site without a home page warns", async () => {
        const x = exportable();
        const homePage = x.doc.nodes[x.home.id] as SceneNode;
        const doc = applyCommand(x.doc, { type: "node.update", id: homePage.id, patch: { site: { kind: "page", path: "/start" } } });
        const build = await buildSite(doc, "publish");
        expect(build.warnings).toContain("The site has no home page (a page at /).");
    });

    it.each([
        ["https://a.b/c?d=1", "https://a.b/c?d=1"],
        ["mailto:x@y.z", "mailto:x@y.z"],
        ["tel:+123", "tel:+123"],
        ["/about", "/about"],
        ["#top", "#top"],
        ["example.com", "https://example.com"],
        ["example.com/path", "https://example.com/path"],
        ["javascript:alert(1)", "#"],
        [" JavaScript:alert(1)", "#"],
        ["data:text/html,<script>", "#"],
        ["vbscript:x", "#"],
        ["", "#"],
        [null, "#"],
    ])("safeUrl(%j) is %j", (raw, want) => {
        expect(safeUrl(raw)).toBe(want);
    });

    it("built page titles and descriptions escape markup", async () => {
        const x = exportable();
        const lib = x.doc.roots.map((id) => x.doc.nodes[id] as SceneNode).find((n) => n.site && "kind" in n.site && n.site.kind === "library") as SceneNode;
        const data = lib.site as Extract<NonNullable<SceneNode["site"]>, { kind: "library" }>;
        const doc = applyCommand(x.doc, { type: "node.update", id: lib.id, patch: { site: { ...data, settings: { ...data.settings, title: `A</title><script>x</script>`, description: `"quoted" & <b>` } } } });
        const html = (await buildSite(doc, "publish")).pages[0]?.html as string;
        expect(html).toContain("<title>A&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>");
        expect(html).toContain('<meta name="description" content="&quot;quoted&quot; &amp; &lt;b&gt;">');
        expect(unbalanced(html)).toEqual([]);
    });
});

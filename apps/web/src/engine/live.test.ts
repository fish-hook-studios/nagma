import "../test/prod-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { activePage } from "./page";
import { editor } from "./store";
import { addMode, addVariable, collectionsOf, createCollection, fieldInfo, setFrameMode, setVariableValue } from "./variables";
import { LIVE_STARTERS, bindLivePropCommand, coerce, declareCommand, liveCodeBlocks, liveCsp, liveFields, liveProps, liveSiteHtml, documentNetwork, liveAppSrcdoc, liveDocument, liveSrcdoc, makeLiveAppNode, makeLiveNode, normalizeSchema, sanitizeOrigin, scriptJson, setAppFilesCommand, setLivePropCommand, setNetworkCommand, setSourceCommand } from "./live";
import { absoluteImports, appComponentFile, inlineModules, liveEntry } from "./live-app";
import { parseLocalCopy, localCopyJson } from "./local-copy";
import { codeBlocks } from "./dev-code";
import type { NagmaDocument, SceneNode } from "./types";
import { makeNode } from "./nodes";
import { buildSite } from "../site/html";
import { bpFrames, createSiteDocument, sitePages } from "../site/model";
import { shortTriggerLabel } from "./interaction-text";

const starter = (id: string) => LIVE_STARTERS.find((s) => s.id === id)!;

function blank(): { doc: NagmaDocument; pageId: string } {
    const page = makeNode({ name: "", nodes: {}, roots: [], images: {} }, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1" });
    return { doc: { name: "Live", nodes: { [page.id]: page }, roots: [page.id], images: {} }, pageId: page.id };
}

const ed = () => editor.get().doc;
const nodeOf = (id: string) => ed().nodes[id] as SceneNode;

describe("Live frame model", () => {
    beforeEach(() => {
        const { doc, pageId } = blank();
        editor.loadDocument(doc, null);
        activePage.id = pageId;
    });

    it("creates a Live frame from a starter with its schema, defaults and events", () => {
        const node = makeLiveNode(ed(), starter("counter"), { x: 10, y: 20 }, activePage.id);
        editor.execute({ type: "node.create", node });
        const n = nodeOf(node.id);
        expect(n.type).toBe("live");
        expect(n.name).toBe("Counter button");
        expect([n.w, n.h]).toEqual([240, 120]);
        expect(n.live?.kind).toBe("html");
        expect(n.live?.schema?.map((s) => s.name)).toEqual(["label", "color", "start"]);
        expect(n.live?.props).toEqual({ label: "Clicked", color: "#3B5BDB", start: 0 });
        expect(n.live?.events).toEqual(["change"]);
        expect(n.fills[0]).toMatchObject({ type: "solid", color: "#FFFFFF" });
    });

    it("updates a prop through the command system, with undo and redo", () => {
        const node = makeLiveNode(ed(), starter("counter"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node });
        editor.execute(setLivePropCommand(nodeOf(node.id), "label", "Tapped"));
        editor.execute(setLivePropCommand(nodeOf(node.id), "start", "5"));
        expect(nodeOf(node.id).live?.props).toMatchObject({ label: "Tapped", start: 5 });
        editor.undo();
        expect(nodeOf(node.id).live?.props.start).toBe(0);
        editor.undo();
        expect(nodeOf(node.id).live?.props.label).toBe("Clicked");
        editor.redo();
        expect(nodeOf(node.id).live?.props.label).toBe("Tapped");
    });

    it("binds a prop to a variable, follows the mode, and unbinds with undo", () => {
        const node = makeLiveNode(ed(), starter("chart"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node });
        const c = createCollection("Theme");
        addMode(c.id, "Dark");
        const coll = collectionsOf(ed()).find((x) => x.id === c.id)!;
        const v = addVariable(c.id, "color", "accent", "#0CA678")!;
        setVariableValue(c.id, v.id, coll.modes[1]!.id, "#E8590C");
        editor.execute(bindLivePropCommand(nodeOf(node.id), "color", v.id));
        expect(nodeOf(node.id).live?.bindings).toEqual({ color: v.id });
        expect(liveProps(ed(), nodeOf(node.id)).color).toBe("#0CA678");
        setFrameMode([activePage.id], c.id, coll.modes[1]!.id);
        expect(liveProps(ed(), nodeOf(node.id)).color).toBe("#E8590C");
        // The player's runtime values win over the document's.
        expect(liveProps(ed(), nodeOf(node.id), { values: { [v.id]: "#111111" } }).color).toBe("#111111");
        // The picker offers colour variables for a colour prop.
        expect(fieldInfo("live:color", nodeOf(node.id)).type).toBe("color");
        expect(fieldInfo("live:values", nodeOf(node.id)).type).toBe("string");
        editor.execute(bindLivePropCommand(nodeOf(node.id), "color", null));
        expect(nodeOf(node.id).live?.bindings).toBeUndefined();
        editor.undo();
        expect(nodeOf(node.id).live?.bindings).toEqual({ color: v.id });
    });

    it("keeps what the code declares, with defaults for new props, and ignores a repeat", () => {
        const node = makeLiveNode(ed(), starter("counter"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node });
        expect(declareCommand(nodeOf(node.id), starter("counter").schema, ["change"])).toBeNull();
        const cmd = declareCommand(nodeOf(node.id), [...starter("counter").schema, { name: "size", type: "select", options: ["S", "M"], default: "M" }, { name: "bad name!", type: "text" }], ["change", "reset"]);
        expect(cmd).not.toBeNull();
        editor.execute(cmd!);
        const live = nodeOf(node.id).live!;
        expect(live.schema?.map((s) => s.name)).toEqual(["label", "color", "start", "size"]);
        expect(live.props.size).toBe("M");
        expect(live.events).toEqual(["change", "reset"]);
    });

    it("changes the source and the network allowance", () => {
        const node = makeLiveNode(ed(), starter("form"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node });
        editor.execute(setSourceCommand(nodeOf(node.id), { html: "<b>hi</b>", css: "b{color:red}", js: "nagma.emit('x')" }));
        expect(nodeOf(node.id).live?.source).toEqual({ html: "<b>hi</b>", css: "b{color:red}", js: "nagma.emit('x')" });
        editor.execute(setNetworkCommand(ed(), ["api.example.com", "javascript:alert(1)", "http://evil.test", "https://api.example.com/path"]));
        expect(ed().liveNetwork).toEqual(["https://api.example.com"]);
        expect(nodeOf(node.id).live?.allow).toBeUndefined();
    });

    it("keeps one network list for the whole document, and moves frames' own lists into it", () => {
        const a = makeLiveNode(ed(), starter("form"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node: { ...a, live: { ...a.live!, allow: ["https://old.example.com"] } } });
        const b = makeLiveNode(ed(), starter("chart"), { x: 400, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node: b });
        // A frame's list from before counts for every frame in the file.
        expect(documentNetwork(ed())).toEqual(["https://old.example.com"]);
        expect(liveDocument(ed(), nodeOf(b.id))).toContain("connect-src https://old.example.com");
        // The next edit moves it into the document's list (one undo step).
        editor.execute(setNetworkCommand(ed(), [...documentNetwork(ed()), "https://api.example.com"]));
        expect(ed().liveNetwork).toEqual(["https://old.example.com", "https://api.example.com"]);
        expect(nodeOf(a.id).live?.allow).toBeUndefined();
        expect(liveDocument(ed(), nodeOf(b.id))).toContain("connect-src https://old.example.com https://api.example.com");
        editor.undo();
        expect(ed().liveNetwork).toBeUndefined();
        expect(nodeOf(a.id).live?.allow).toEqual(["https://old.example.com"]);
        editor.redo();
        editor.execute(setNetworkCommand(ed(), []));
        expect(ed().liveNetwork).toBeUndefined();
        expect(documentNetwork(ed())).toEqual([]);
    });

    it("makes a React component frame and a Make app frame, each running a project's files", () => {
        const react = makeLiveNode(ed(), starter("react"), { x: 0, y: 0 }, activePage.id);
        editor.execute({ type: "node.create", node: react });
        expect(nodeOf(react.id).live?.kind).toBe("app");
        expect(Object.keys(nodeOf(react.id).live?.files ?? {})).toEqual(["src/App.jsx"]);
        expect(nodeOf(react.id).live?.props).toMatchObject({ title: "Pick a plan", rounded: true });
        const app = makeLiveAppNode(ed(), { id: "make123", name: "Todo app", files: { "src/App.tsx": "export default function App() { return null; }" } }, { x: 0, y: 300 }, activePage.id);
        editor.execute({ type: "node.create", node: app });
        expect(nodeOf(app.id).live).toMatchObject({ kind: "app", app: "make123", appName: "Todo app" });
        editor.execute(setAppFilesCommand(nodeOf(app.id), { "src/App.tsx": "export default () => 1;" }));
        expect(nodeOf(app.id).live?.files).toEqual({ "src/App.tsx": "export default () => 1;" });
        // Inspect lists the files, and the app it came from.
        const titles = liveCodeBlocks(ed(), nodeOf(app.id)).map((b) => b.title);
        expect(titles).toContain("src/App.tsx");
        expect(titles).toContain("Make app");
        // Until its bundle is ready, the frame shows a placeholder under the same sandbox rules.
        expect(liveDocument(ed(), nodeOf(app.id))).toContain("Loading");
    });
});

describe("Live frame document (srcdoc)", () => {
    it("blocks the network unless origins are allowed", () => {
        const off = liveCsp();
        expect(off).toContain("default-src 'none'");
        expect(off).toContain("connect-src 'none'");
        expect(off).toContain("form-action 'none'");
        const on = liveCsp(["https://api.example.com", "x; script-src *"]);
        expect(on).toContain("connect-src https://api.example.com");
        expect(on).not.toContain("*");
        expect(sanitizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
        expect(sanitizeOrigin("ftp://x.com")).toBeNull();
    });

    it("carries the CSP, the runtime and the props, and can't be broken out of", () => {
        const html = liveSrcdoc({ html: "<div id=a></div>", css: "</style><b>bad</b>", js: "console.log('</script><b>')" }, { label: "</script><img src=x onerror=alert(1)>", n: 3 });
        expect(html).toMatch(/^<!doctype html>/);
        expect(html).toContain('http-equiv="Content-Security-Policy"');
        expect(html).toContain("window.nagma");
        expect(html).toContain("declare: function");
        expect(html).toContain('"n":3');
        // Props are escaped inside the script, and the code can't close its own tags early.
        expect(html).not.toContain("</script><img");
        expect(html).toContain("\\u003c/script>\\u003cimg");
        expect(html).not.toContain("</style><b>bad");
        expect(html.match(/<\/script>/g)?.length).toBe(2);
        expect(scriptJson({ a: "<!--" })).toBe('{"a":"\\u003c!--"}');
    });
});

describe("Inspector fields from a schema", () => {
    it("maps each prop type to a control and a variable type", () => {
        const schema = normalizeSchema([
            { name: "title", type: "text" },
            { name: "count", type: "number", min: 0, max: 10, step: 2 },
            { name: "on", type: "boolean" },
            { name: "tint", type: "color" },
            { name: "size", type: "select", options: ["S", "M", 3] },
            { name: "photo", type: "image" },
            { name: "values", type: "numbers" },
            { name: "odd", type: "weird" },
        ]);
        const fields = liveFields(schema);
        expect(fields.map((f) => [f.name, f.control, f.variableType])).toEqual([
            ["title", "text", "string"],
            ["count", "number", "number"],
            ["on", "toggle", "boolean"],
            ["tint", "color", "color"],
            ["size", "select", "string"],
            ["photo", "image", "string"],
            ["values", "numbers", "string"],
            ["odd", "text", "string"],
        ]);
        expect(fields[1]).toMatchObject({ min: 0, max: 10, step: 2, label: "Count" });
        expect(fields[4]?.options).toEqual(["S", "M"]);
        expect(liveFields(normalizeSchema([{ name: "buttonText", type: "text" }]))[0]?.label).toBe("Button text");
    });

    it("coerces values to their prop type", () => {
        expect(coerce("numbers", "1, 2;x 3")).toEqual([1, 2, 3]);
        expect(coerce("number", "4.5")).toBe(4.5);
        expect(coerce("number", "nope")).toBeUndefined();
        expect(coerce("boolean", "true")).toBe(true);
        expect(coerce("text", 7)).toBe("7");
    });
});

describe("Live frames in Inspect, Sites, the prototype and a local copy", () => {
    it("shows the source as it is in Inspect, for any language", () => {
        const { doc, pageId } = blank();
        const node = makeLiveNode(doc, starter("counter"), { x: 0, y: 0 }, pageId);
        const next = applyCommand(doc, { type: "node.create", node });
        const blocks = codeBlocks(next.nodes[node.id]!, next, { lang: "swiftui", unit: "px", scale: 16 });
        expect(blocks.map((b) => b.title)).toEqual(["HTML", "CSS", "JavaScript", "Props"]);
        expect(blocks[2]?.lines.join("\n")).toBe(starter("counter").source?.js);
        expect(liveCodeBlocks(next, next.nodes[node.id]!)[3]?.lines.join("")).toContain('"label": "Clicked"');
    });

    it("publishes in Sites as a sandboxed frame with its code and current props", async () => {
        const doc = createSiteDocument("Shop");
        const home = sitePages(doc)[0] as SceneNode;
        activePage.id = home.id;
        const desktop = bpFrames(doc, home.id).desktop as SceneNode;
        const node = makeLiveNode(doc, starter("chart"), { x: desktop.x + 20, y: desktop.y + 20 }, desktop.id);
        editor.loadDocument(doc, null);
        activePage.id = home.id;
        editor.execute({ type: "node.create", node });
        editor.execute(setLivePropCommand(nodeOf(node.id), "title", "Monthly sales"));
        const build = await buildSite(ed(), "preview");
        const html = build.pages[0]!.html;
        expect(html).toContain('<iframe sandbox="allow-scripts"');
        expect(html).not.toContain("allow-same-origin");
        expect(html).toContain("srcdoc=");
        expect(html).toContain("Monthly sales");
        expect(html).toContain("default-src 'none'");
        const direct = liveSiteHtml(ed(), nodeOf(node.id));
        expect(direct).toContain("width:100%;height:100%");
    });

    it("names the event trigger", () => {
        expect(shortTriggerLabel({ trigger: "live-event", event: "submit" })).toBe("On event: submit");
        expect(shortTriggerLabel({ trigger: "live-event" })).toBe("On event");
    });

    it("round trips through a .nagma.json local copy", async () => {
        const { doc, pageId } = blank();
        let next = doc;
        const node = makeLiveNode(next, starter("form"), { x: 5, y: 6 }, pageId);
        next = applyCommand(next, { type: "node.create", node });
        next = applyCommand(next, setLivePropCommand(next.nodes[node.id]!, "buttonText", "Join"));
        next = applyCommand(next, setNetworkCommand(next, ["https://api.example.com"]));
        next = applyCommand(next, { type: "node.update", id: node.id, patch: { interactions: [{ trigger: "live-event", event: "submit", delay: 0, actions: [{ type: "back" }] }] } });
        next = applyCommand(next, bindLivePropCommand(next.nodes[node.id]!, "color", "var1"));
        const parsed = parseLocalCopy(await localCopyJson(next)).doc;
        const back = parsed.nodes[node.id]!;
        expect(back.type).toBe("live");
        expect(back.live).toEqual(next.nodes[node.id]!.live);
        expect(parsed.liveNetwork).toEqual(["https://api.example.com"]);
        expect(back.interactions?.[0]).toMatchObject({ trigger: "live-event", event: "submit" });
    });
});

describe("Live frames running an app (bundled, network off)", () => {
    it("finds the component to show and writes an entry that renders it with the props", () => {
        expect(appComponentFile({ "src/App.tsx": "export default function App() {}", "src/main.tsx": "" })).toBe("src/App.tsx");
        expect(appComponentFile({ "src/App.tsx": "export function App() {}" })).toBeNull();
        const entry = liveEntry({ "src/App.tsx": "export default 1", "src/main.tsx": 'import "./index.css";\nimport "../styles/base.css";\nimport App from "./App";' }, "src/App.tsx");
        expect(entry.path).toBe("src/__nagma_live.jsx");
        expect(entry.code).toContain('import "./index.css";');
        expect(entry.code).toContain('import "../styles/base.css";');
        expect(entry.code).toContain('import App from "./App";');
        expect(entry.code).toContain("window.nagma.on(\"props\", draw)");
    });

    it("makes a module's own imports absolute, leaving bare names to the import map", () => {
        const { code, imports } = absoluteImports('import*as a from"/react@19/es2022/react.mjs";import b from "react";export*from"./x.mjs";import("../y.mjs")', "https://esm.sh/pkg@1/es2022/pkg.mjs");
        expect(imports).toEqual(["https://esm.sh/react@19/es2022/react.mjs", "https://esm.sh/pkg@1/es2022/x.mjs", "https://esm.sh/pkg@1/y.mjs"]);
        expect(code).toContain('from"https://esm.sh/react@19/es2022/react.mjs"');
        expect(code).toContain('from "react"');
        expect(code).toContain('import("https://esm.sh/pkg@1/y.mjs")');
    });

    it("inlines every CDN module as data, and lets through only the origins it couldn't fetch", async () => {
        const served: Record<string, string> = {
            "https://cdn.test/react@1": 'export * from "/react@1/react.mjs";',
            "https://cdn.test/react@1/react.mjs": "export const version = 1;",
            "https://cdn.test/lib@2": 'import "react"; export * from "/lib@2/lib.mjs";',
            "https://cdn.test/lib@2/lib.mjs": 'import x from "https://other.test/dep.mjs"; export default x; const warn = "write it as import A from \'./MyComponent\'";',
        };
        // other.test can't be reached; anything else unknown is a 404 (no such module).
        const fetcher = (async (url: string) => {
            if (url.startsWith("https://other.test/")) throw new TypeError("Failed to fetch");
            return served[url] !== undefined ? new Response(served[url], { status: 200 }) : new Response("", { status: 404 });
        }) as unknown as typeof fetch;
        const { map, blocked } = await inlineModules({ react: "https://cdn.test/react@1", lib: "https://cdn.test/lib@2", local: "data:text/javascript,1" }, fetcher);
        expect(map.react).toMatch(/^data:text\/javascript;base64,/);
        expect(map.lib).toMatch(/^data:text\/javascript;base64,/);
        expect(map["https://cdn.test/react@1/react.mjs"]).toMatch(/^data:/);
        expect(atob(map.react!.split(",")[1]!)).toContain('"https://cdn.test/react@1/react.mjs"');
        expect(map.local).toBe("data:text/javascript,1");
        // The one module that couldn't be fetched keeps its address; its origin is let through. An
        // import written inside a string (a 404 at the CDN) is no module, and opens nothing.
        expect(map["https://other.test/dep.mjs"]).toBeUndefined();
        expect(blocked).toEqual(["https://other.test"]);
    });

    it("runs the bundle with data: modules allowed and the network otherwise off", () => {
        const html = liveAppSrcdoc({ key: "k", head: '<script type="importmap">{}</script>', body: '<div id="root"></div>', blocked: ["https://esm.sh"], errors: [], component: true }, { title: "Hi" }, { allow: [], title: "App" });
        expect(html).toContain("script-src 'unsafe-inline' data: https://esm.sh");
        expect(html).toContain("connect-src 'none'");
        expect(html).toContain('{"title":"Hi"}');
        expect(html.indexOf("window.nagma")).toBeLessThan(html.indexOf("importmap"));
        const failed = liveAppSrcdoc({ key: "k", head: "", body: "", blocked: [], errors: ["src/App.tsx: Unexpected token"], component: false }, {}, {});
        expect(failed).toContain("Unexpected token");
    });
});

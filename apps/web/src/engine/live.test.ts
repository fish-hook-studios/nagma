import "../test/prod-fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { activePage } from "./page";
import { editor } from "./store";
import { addMode, addVariable, collectionsOf, createCollection, fieldInfo, setFrameMode, setVariableValue } from "./variables";
import { LIVE_STARTERS, bindLivePropCommand, coerce, declareCommand, liveCodeBlocks, liveCsp, liveFields, liveProps, liveSiteHtml, liveSrcdoc, makeLiveNode, normalizeSchema, sanitizeOrigin, scriptJson, setAllowCommand, setLivePropCommand, setSourceCommand } from "./live";
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
        editor.execute(setAllowCommand(nodeOf(node.id), ["api.example.com", "javascript:alert(1)", "http://evil.test", "https://api.example.com/path"]));
        expect(nodeOf(node.id).live?.allow).toEqual(["https://api.example.com"]);
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
        expect(blocks[2]?.lines.join("\n")).toBe(starter("counter").source.js);
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
        next = applyCommand(next, setAllowCommand(next.nodes[node.id]!, ["https://api.example.com"]));
        next = applyCommand(next, { type: "node.update", id: node.id, patch: { interactions: [{ trigger: "live-event", event: "submit", delay: 0, actions: [{ type: "back" }] }] } });
        next = applyCommand(next, bindLivePropCommand(next.nodes[node.id]!, "color", "var1"));
        const parsed = parseLocalCopy(await localCopyJson(next)).doc;
        const back = parsed.nodes[node.id]!;
        expect(back.type).toBe("live");
        expect(back.live).toEqual(next.nodes[node.id]!.live);
        expect(back.interactions?.[0]).toMatchObject({ trigger: "live-event", event: "submit" });
    });
});

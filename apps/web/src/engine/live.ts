import { type LiveAppBuild, cachedLiveApp } from "./live-app";
import { LIVE_RUNTIME } from "./live-runtime";
import { LIVE_STARTERS, type LiveStarter } from "./live-starters";
import { makeNode } from "./nodes";
import { resolveVariable } from "./variables";
import type { Command, LiveData, LivePropSchema, LivePropType, LiveSource, NagmaDocument, Rect, SceneNode, VariableType, VariableValue } from "./types";

// Live frames: a layer whose content is code (HTML, CSS and JavaScript), run in a sandboxed frame on
// the canvas. The code reads props the Inspector edits (and variables they are bound to) through
// `nagma.props`, sends events out with `nagma.emit`, and declares its props with `nagma.declare`.
//
// This module is the model and the pure pieces: the frame's document (srcdoc) with its content
// security policy and runtime, the props as the code sees them, the Inspector's fields for a schema,
// and the commands that change a Live frame (so undo, sync, history and comments work as for any
// layer). The canvas side lives in canvas/live-frames.tsx.

export type { LiveStarter };
export { LIVE_STARTERS };

const PROP_TYPES: LivePropType[] = ["text", "number", "boolean", "color", "select", "image", "numbers"];
const MAX_PROPS = 40;
const MAX_EVENTS = 20;

export function isLive(node: SceneNode | undefined | null): node is SceneNode & { live: LiveData } {
    return Boolean(node && node.type === "live" && node.live);
}

export function liveOf(node: SceneNode): LiveData {
    return node.live ?? { kind: "html", source: { html: "", css: "", js: "" }, props: {} };
}

export function sourceOf(node: SceneNode): LiveSource {
    return liveOf(node).source ?? { html: "", css: "", js: "" };
}

// ---- Schema ----

const nameOk = (n: unknown): n is string => typeof n === "string" && /^[A-Za-z_$][\w$-]{0,39}$/.test(n);

// A schema as the code sent it (untrusted: it comes out of the sandbox), kept to what the Inspector
// understands.
export function normalizeSchema(raw: unknown): LivePropSchema[] {
    if (!Array.isArray(raw)) return [];
    const out: LivePropSchema[] = [];
    const seen = new Set<string>();
    for (const item of raw.slice(0, MAX_PROPS)) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        if (!nameOk(r.name) || seen.has(r.name)) continue;
        const type = PROP_TYPES.includes(r.type as LivePropType) ? (r.type as LivePropType) : "text";
        const entry: LivePropSchema = { name: r.name, type };
        if (typeof r.label === "string" && r.label.trim()) entry.label = r.label.trim().slice(0, 60);
        if (r.default !== undefined) {
            const d = coerce(type, r.default);
            if (d !== undefined) entry.default = d;
        }
        if (type === "select" && Array.isArray(r.options)) entry.options = r.options.filter((o): o is string => typeof o === "string").slice(0, 50).map((o) => o.slice(0, 80));
        for (const key of ["min", "max", "step"] as const) if (typeof r[key] === "number" && Number.isFinite(r[key])) entry[key] = r[key] as number;
        seen.add(r.name);
        out.push(entry);
    }
    return out;
}

export function normalizeEvents(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((e): e is string => typeof e === "string" && e.trim().length > 0).map((e) => e.trim().slice(0, 80)))].slice(0, MAX_EVENTS);
}

// A value made to fit a prop's type (undefined when it can't be).
export function coerce(type: LivePropType, value: unknown): unknown {
    switch (type) {
        case "number": {
            const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
            return Number.isFinite(n) ? n : undefined;
        }
        case "boolean":
            return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : undefined;
        case "numbers": {
            const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/).filter(Boolean) : null;
            if (!list) return undefined;
            return list.map(Number).filter((n) => Number.isFinite(n)).slice(0, 500);
        }
        case "color":
            return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : typeof value === "string" ? value.slice(0, 60) : undefined;
        default:
            return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
    }
}

export function defaultsOf(schema: LivePropSchema[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const s of schema) if (s.default !== undefined) out[s.name] = s.default;
    return out;
}

// The variable type a prop can bind to.
export function variableTypeFor(type: LivePropType): VariableType {
    if (type === "number") return "number";
    if (type === "boolean") return "boolean";
    if (type === "color") return "color";
    return "string";
}

// The Inspector's control for each prop.
export type LiveControl = "text" | "number" | "toggle" | "color" | "select" | "image" | "numbers";
export interface LiveField {
    name: string;
    label: string;
    control: LiveControl;
    variableType: VariableType;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
}

const CONTROLS: Record<LivePropType, LiveControl> = { text: "text", number: "number", boolean: "toggle", color: "color", select: "select", image: "image", numbers: "numbers" };

// "buttonText" reads "Button text".
export function labelFor(name: string): string {
    const words = name
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim()
        .toLowerCase();
    return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

export function liveFields(schema: LivePropSchema[] | undefined): LiveField[] {
    return (schema ?? []).map((s) => ({
        name: s.name,
        label: s.label ?? labelFor(s.name),
        control: CONTROLS[s.type],
        variableType: variableTypeFor(s.type),
        ...(s.options ? { options: s.options } : {}),
        ...(s.min !== undefined ? { min: s.min } : {}),
        ...(s.max !== undefined ? { max: s.max } : {}),
        ...(s.step !== undefined ? { step: s.step } : {}),
    }));
}

// ---- Props as the code sees them ----

type Overrides = { values?: Record<string, VariableValue>; modes?: Record<string, string> };

// The props: the schema's defaults, then the set values, then bound variables (resolved in the
// layer's mode, or the player's runtime values and modes).
export function liveProps(doc: NagmaDocument, node: SceneNode, overrides?: Overrides): Record<string, unknown> {
    const live = liveOf(node);
    const schema = live.schema ?? [];
    const out: Record<string, unknown> = { ...defaultsOf(schema), ...live.props };
    for (const [name, id] of Object.entries(live.bindings ?? {})) {
        const r = resolveVariable(doc, id, node, overrides);
        if (!r || typeof r.value === "object") continue;
        const type = schema.find((s) => s.name === name)?.type ?? "text";
        const v = coerce(type, r.value);
        if (v !== undefined) out[name] = v;
    }
    return out;
}

// Bound variables by name, for `nagma.variables`.
export function liveVariables(doc: NagmaDocument, node: SceneNode, overrides?: Overrides): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const id of Object.values(liveOf(node).bindings ?? {})) {
        const found = doc.variables?.flatMap((c) => c.variables).find((v) => v.id === id);
        const r = resolveVariable(doc, id, node, overrides);
        if (found && r && typeof r.value !== "object") out[found.name] = r.value;
    }
    return out;
}

// ---- The frame's document ----

// An origin the person approved, as CSP takes it ("https://api.example.com"), or null.
export function sanitizeOrigin(raw: string): string | null {
    const t = raw.trim();
    if (!t) return null;
    let url: URL;
    try {
        url = new URL(t.includes("://") ? t : `https://${t}`);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) return null;
    if (!/^[a-z0-9.-]+$/i.test(url.hostname) || url.username || url.password) return null;
    return url.origin;
}

const cleanOrigins = (list: string[]) => [...new Set(list.map(sanitizeOrigin).filter((o): o is string => Boolean(o)))];

// The origins every Live frame in the document may reach: the document's list, and lists frames
// kept for themselves before the list was the document's (moved there on the next edit).
export function documentNetwork(doc: NagmaDocument): string[] {
    const legacy: string[] = [];
    for (const node of Object.values(doc.nodes)) if (node.type === "live" && node.live?.allow?.length) legacy.push(...node.live.allow);
    return cleanOrigins([...(doc.liveNetwork ?? []), ...legacy]);
}

// Sets the document's list, and moves frames' own lists into it (one step, so it undoes as one).
export function setNetworkCommand(doc: NagmaDocument, allow: string[]): Command {
    const clean = cleanOrigins(allow);
    const commands: Command[] = [{ type: "doc.settings", patch: { liveNetwork: clean.length ? clean : undefined } }];
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "live" || !node.live?.allow) continue;
        const { allow: _old, ...rest } = node.live;
        commands.push({ type: "node.update", id: node.id, patch: { live: rest } });
    }
    return commands.length === 1 ? (commands[0] as Command) : { type: "batch", commands };
}

// Network is off unless origins are allowed: scripts and styles inline only, pictures and fonts as
// data, no requests, no forms, no frames, no base. The approved origins open each of those. An app
// frame (`modules`) also runs data: modules (its bundle), and scripts from `scripts` (modules that
// couldn't be kept offline).
export function liveCsp(allow: string[] = [], options: { modules?: boolean; scripts?: string[] } = {}): string {
    const origins = cleanOrigins(allow);
    const extra = origins.length ? ` ${origins.join(" ")}` : "";
    const scripts = cleanOrigins(options.scripts ?? []).filter((o) => !origins.includes(o));
    return [
        "default-src 'none'",
        `script-src 'unsafe-inline'${options.modules ? " data:" : ""}${extra}${scripts.length ? ` ${scripts.join(" ")}` : ""}`,
        `style-src 'unsafe-inline'${extra}`,
        `img-src data: blob:${extra}`,
        `font-src data:${extra}`,
        `media-src data: blob:${extra}`,
        `connect-src ${origins.length ? origins.join(" ") : "'none'"}`,
        "form-action 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
    ].join("; ");
}

// JSON safe inside a <script>: no "</script>", no HTML comment openers.
export function scriptJson(value: unknown): string {
    return (JSON.stringify(value ?? null) ?? "null").replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The frame's whole document: CSP, the runtime with the initial props, the code's CSS, HTML and
// JavaScript. Props that change later arrive by postMessage, so the document (and the running
// code) stays as it is.
export function liveSrcdoc(source: LiveSource, props: Record<string, unknown>, options: { allow?: string[]; variables?: Record<string, unknown>; title?: string } = {}): string {
    const runtime = LIVE_RUNTIME.replace("__NL_PROPS__", () => scriptJson(props)).replace("__NL_VARS__", () => scriptJson(options.variables ?? {}));
    const css = source.css.replace(/<\/style/gi, "<\\/style");
    const js = source.js.replace(/<\/script/gi, "<\\/script");
    return (
        "<!doctype html><html><head>" +
        '<meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${attrEsc(liveCsp(options.allow))}">` +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        (options.title ? `<title>${attrEsc(options.title)}</title>` : "") +
        "<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>" +
        `<style>${css}</style>` +
        `<script>${runtime}</script>` +
        "</head><body>" +
        source.html +
        `<script>${js}\n</script>` +
        "</body></html>"
    );
}

// An app frame's document: the runtime, then the bundle (import map, styles, the app's markup and
// entry). Until the bundle is ready, a quiet placeholder.
export function liveAppSrcdoc(build: LiveAppBuild | null, props: Record<string, unknown>, options: { allow?: string[]; variables?: Record<string, unknown>; title?: string } = {}): string {
    if (!build) return liveSrcdoc(PENDING, props, options);
    if (!build.head && build.errors.length) return liveSrcdoc(failedSource(build.errors), props, options);
    const runtime = LIVE_RUNTIME.replace("__NL_PROPS__", () => scriptJson(props)).replace("__NL_VARS__", () => scriptJson(options.variables ?? {}));
    return (
        "<!doctype html><html><head>" +
        '<meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${attrEsc(liveCsp(options.allow, { modules: true, scripts: build.blocked }))}">` +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        (options.title ? `<title>${attrEsc(options.title)}</title>` : "") +
        "<style>html,body{margin:0;padding:0;width:100%;height:100%}</style>" +
        `<script>${runtime}</script>` +
        build.head +
        "</head><body>" +
        build.body +
        "</body></html>"
    );
}

const PENDING: LiveSource = { html: '<div class="nl-wait">Loading…</div>', css: ".nl-wait{display:grid;place-items:center;height:100%;font:500 12px system-ui,sans-serif;color:#8a8a8a}", js: "" };
const failedSource = (errors: string[]): LiveSource => ({ html: "<pre class=\"nl-fail\"></pre>", css: ".nl-fail{margin:12px;font:12px/1.4 ui-monospace,monospace;color:#c92a2a;white-space:pre-wrap}", js: `document.querySelector(".nl-fail").textContent = ${scriptJson(errors.join("\n"))};` });

// The sandbox every Live frame runs in: scripts only, its own opaque origin (never same-origin, so
// it can't reach the editor's storage, cookies or tokens).
export const LIVE_SANDBOX = "allow-scripts";

// The frame's document for a layer now (an app frame's from its finished bundle, or a placeholder).
export function liveDocument(doc: NagmaDocument, node: SceneNode, overrides?: Overrides): string {
    const options = { allow: documentNetwork(doc), variables: liveVariables(doc, node, overrides), title: node.name };
    const live = liveOf(node);
    if (live.kind === "app") return liveAppSrcdoc(cachedLiveApp(live.files), liveProps(doc, node, overrides), options);
    return liveSrcdoc(sourceOf(node), liveProps(doc, node, overrides), options);
}

// ---- Creating and changing ----

export const LIVE_SIZE = { w: 320, h: 200 };

export function makeLiveNode(doc: NagmaDocument, starter: LiveStarter, rect: Partial<Rect> & { x: number; y: number }, parentId: string | null): SceneNode {
    const schema = normalizeSchema(starter.schema);
    const content: Pick<LiveData, "kind" | "source" | "files"> = starter.files ? { kind: "app", files: { ...starter.files } } : { kind: "html", source: { ...(starter.source ?? { html: "", css: "", js: "" }) } };
    const node = makeNode(doc, "live", { x: rect.x, y: rect.y, w: rect.w ?? starter.w ?? LIVE_SIZE.w, h: rect.h ?? starter.h ?? LIVE_SIZE.h }, parentId, {
        name: starter.name,
        clip: true,
        live: { ...content, props: defaultsOf(schema), schema, events: normalizeEvents(starter.events) },
    });
    return node;
}

export const LIVE_APP_SIZE = { w: 480, h: 360 };

// A Live frame running a Make app: a copy of its files, and the app it came from.
export function makeLiveAppNode(doc: NagmaDocument, app: { id: string; name: string; files: Record<string, string> }, rect: Partial<Rect> & { x: number; y: number }, parentId: string | null): SceneNode {
    return makeNode(doc, "live", { x: rect.x, y: rect.y, w: rect.w ?? LIVE_APP_SIZE.w, h: rect.h ?? LIVE_APP_SIZE.h }, parentId, {
        name: app.name,
        clip: true,
        live: { kind: "app", app: app.id, appName: app.name, files: { ...app.files }, props: {} },
    });
}

// Replaces an app frame's files (the Make app changed, or its code was edited here).
export function setAppFilesCommand(node: SceneNode, files: Record<string, string>): Command {
    return liveUpdate(node, { files: { ...files } });
}

export function liveUpdate(node: SceneNode, patch: Partial<LiveData>): Command {
    return { type: "node.update", id: node.id, patch: { live: { ...liveOf(node), ...patch } } };
}

export function setLivePropCommand(node: SceneNode, name: string, value: unknown): Command {
    const live = liveOf(node);
    const type = live.schema?.find((s) => s.name === name)?.type;
    const v = type ? coerce(type, value) : value;
    const props = { ...live.props };
    if (v === undefined) delete props[name];
    else props[name] = v;
    return liveUpdate(node, { props });
}

export function bindLivePropCommand(node: SceneNode, name: string, variableId: string | null): Command {
    const bindings = { ...(liveOf(node).bindings ?? {}) };
    if (variableId) bindings[name] = variableId;
    else delete bindings[name];
    return liveUpdate(node, { bindings: Object.keys(bindings).length ? bindings : undefined });
}

export function setSourceCommand(node: SceneNode, source: LiveSource): Command {
    return liveUpdate(node, { source: { html: source.html, css: source.css, js: source.js } });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What the code declared, kept on the layer when it differs: the schema, the events, and defaults
// for props that have no value yet. Null when nothing changes.
export function declareCommand(node: SceneNode, rawSchema: unknown, rawEvents: unknown): Command | null {
    const live = liveOf(node);
    const schema = normalizeSchema(rawSchema);
    const events = normalizeEvents(rawEvents);
    const props = { ...defaultsOf(schema), ...live.props };
    if (same(schema, live.schema ?? []) && same(events, live.events ?? []) && same(props, live.props)) return null;
    return liveUpdate(node, { schema, events, props });
}

// ---- Inspect and Sites ----

// Inspect's Code section: the source as it is, and the props it runs with.
export function liveCodeBlocks(doc: NagmaDocument, node: SceneNode): { title: string; lines: string[] }[] {
    const live = liveOf(node);
    const source = sourceOf(node);
    const blocks: { title: string; lines: string[] }[] = [];
    if (source.html.trim()) blocks.push({ title: "HTML", lines: source.html.split("\n") });
    if (source.css.trim()) blocks.push({ title: "CSS", lines: source.css.split("\n") });
    if (source.js.trim()) blocks.push({ title: "JavaScript", lines: source.js.split("\n") });
    if (live.kind === "app") for (const [path, text] of Object.entries(live.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) blocks.push({ title: path, lines: text.split("\n") });
    const props = liveProps(doc, node);
    if (Object.keys(props).length) blocks.push({ title: "Props", lines: JSON.stringify(props, null, 2).split("\n") });
    if (live.kind === "app" && live.app) blocks.push({ title: "Make app", lines: [live.appName ? `${live.appName} (${live.app})` : live.app] });
    return blocks;
}

// A published Live frame: the same sandboxed frame with the code and its current props, filling
// its layer's box (the box itself is laid out like any other layer).
export function liveSiteHtml(doc: NagmaDocument, node: SceneNode): string {
    const srcdoc = liveDocument(doc, node);
    return `<iframe sandbox="${LIVE_SANDBOX}" title="${attrEsc(node.name)}" loading="lazy" srcdoc="${attrEsc(srcdoc)}" style="border:0;width:100%;height:100%;display:block;background:transparent"></iframe>`;
}

// The props of every Live frame bound to a variable, for checks that a mode change reaches them.
export function liveBindingsOf(doc: NagmaDocument): { node: SceneNode; name: string; variableId: string }[] {
    const out: { node: SceneNode; name: string; variableId: string }[] = [];
    for (const node of Object.values(doc.nodes)) if (node.type === "live") for (const [name, variableId] of Object.entries(node.live?.bindings ?? {})) out.push({ node, name, variableId });
    return out;
}

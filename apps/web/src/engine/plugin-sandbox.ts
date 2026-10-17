// The script that runs inside a plugin's sandboxed iframe (an opaque origin with no access to the
// editor's page, storage or cookies). It builds the `nagma` global over a snapshot of the file the
// host sends in, queues every change as an operation for the host to apply, and forwards console
// output, notifications, UI messages and codegen results. Plain JavaScript in a string, because it
// is injected into the frame as is.

import { legacy } from "./legacy-names";

export const SANDBOX_SOURCE = String.raw`
(() => {
    "use strict";
    const send = (msg) => parent.postMessage(msg, "*");
    let snap = { nodes: {}, pageIds: [], pageId: "", selection: [], docName: "", mode: "default", editorType: "nagma" };
    let pending = [];
    let flushQueued = false;
    let requestSeq = 0;
    const requests = new Map();
    const listeners = {};
    const wrappers = new Map();
    const paintSource = new WeakMap();
    let manifest = {};
    let uiHandler = null;
    const uiListeners = [];

    // ---- Console and errors ----
    const show = (v) => {
        if (typeof v === "string") return v;
        try { return JSON.stringify(v, (k, x) => (x && typeof x === "object" && x.__nagmaNode ? "[" + x.type + " " + x.id + "]" : x)); } catch { return String(v); }
    };
    for (const level of ["log", "info", "warn", "error", "debug"]) {
        console[level] = (...args) => send({ kind: "console", level, text: args.map(show).join(" ") });
    }
    addEventListener("error", (e) => send({ kind: "console", level: "error", text: String(e.message || e.error) }));
    addEventListener("unhandledrejection", (e) => send({ kind: "console", level: "error", text: "Unhandled: " + show(e.reason && e.reason.message ? e.reason.message : e.reason) }));

    // ---- Changes go to the host in batches ----
    const queue = (op) => {
        pending.push(op);
        if (!flushQueued) {
            flushQueued = true;
            queueMicrotask(flush);
        }
    };
    const flush = () => {
        flushQueued = false;
        if (pending.length) send({ kind: "ops", ops: pending });
        pending = [];
    };
    const ask = (method, args) => {
        flush();
        const id = ++requestSeq;
        send({ kind: "request", id, method, args });
        return new Promise((resolve, reject) => requests.set(id, { resolve, reject }));
    };
    const emit = (event, ...args) => {
        for (const fn of listeners[event] || []) {
            try { fn(...args); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); }
        }
    };

    // ---- Paints ----
    const hexToRgb = (hex) => {
        const h = String(hex || "#000000").replace("#", "");
        const full = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6);
        const n = parseInt(full || "0", 16);
        return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    };
    const rgbToHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v || 0)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
    const gradientTypes = { linear: "GRADIENT_LINEAR", radial: "GRADIENT_RADIAL", angular: "GRADIENT_ANGULAR", diamond: "GRADIENT_DIAMOND" };
    const toPaint = (p) => {
        const base = { visible: p.visible !== false, opacity: p.opacity == null ? 1 : p.opacity, blendMode: String(p.blend || "normal").toUpperCase().replace(/-/g, "_") };
        let out;
        if (p.type === "solid") out = Object.assign({ type: "SOLID", color: hexToRgb(p.color) }, base);
        else if (gradientTypes[p.type]) out = Object.assign({ type: gradientTypes[p.type], gradientStops: (p.stops || []).map((s) => ({ position: s.position, color: Object.assign(hexToRgb(s.color), { a: s.opacity == null ? 1 : s.opacity }) })), gradientTransform: [[1, 0, 0], [0, 1, 0]] }, base);
        else if (p.type === "image") out = Object.assign({ type: "IMAGE", imageHash: p.id, scaleMode: String(p.scale || "fill").toUpperCase() }, base);
        else out = Object.assign({ type: "PATTERN", sourceNodeId: p.sourceId }, base);
        paintSource.set(out, p);
        return Object.freeze(out);
    };
    const fromPaint = (p) => {
        if (paintSource.has(p)) return paintSource.get(p);
        const base = { visible: p.visible !== false, opacity: p.opacity == null ? 1 : p.opacity, blend: String(p.blendMode || "NORMAL").toLowerCase().replace(/_/g, "-") };
        if (p.type === "SOLID") return Object.assign({ type: "solid", color: rgbToHex(p.color || {}) }, base);
        const g = Object.keys(gradientTypes).find((k) => gradientTypes[k] === p.type);
        if (g) return Object.assign({ type: g, stops: (p.gradientStops || []).map((s) => ({ position: s.position, color: rgbToHex(s.color || {}), opacity: s.color && s.color.a != null ? s.color.a : 1 })), from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } }, base);
        if (p.type === "IMAGE") return Object.assign({ type: "image", id: p.imageHash, scale: String(p.scaleMode || "FILL").toLowerCase() }, base);
        throw new Error("Unsupported paint type: " + p.type);
    };

    // ---- Nodes ----
    const TYPES = { page: "PAGE", frame: "FRAME", component: "COMPONENT", componentSet: "COMPONENT_SET", instance: "INSTANCE", group: "GROUP", boolean: "BOOLEAN_OPERATION", rect: "RECTANGLE", ellipse: "ELLIPSE", vector: "VECTOR", text: "TEXT" };
    const CONTAINERS = new Set(["page", "frame", "component", "componentSet", "instance", "group", "boolean"]);
    const raw = (id) => {
        const n = snap.nodes[id];
        if (!n) throw new Error("The node " + id + " was removed.");
        return n;
    };
    const update = (id, patch) => {
        snap.nodes[id] = Object.assign({}, raw(id), patch);
        queue({ op: "update", id, patch });
    };
    const weights = { Thin: 100, "Extra Light": 200, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, "Semi Bold": 600, SemiBold: 600, Bold: 700, "Extra Bold": 800, ExtraBold: 800, Black: 900 };
    const styleName = (n) => {
        const w = Object.keys(weights).find((k) => weights[k] === Math.round((n.fontWeight || 400) / 100) * 100 && !k.includes(" ")) || "Regular";
        return n.italic ? (w === "Regular" ? "Italic" : w + " Italic") : w;
    };
    // Layers keep page coordinates in the file; the API's x and y are relative to the parent.
    const origin = (parentId) => {
        const p = parentId ? snap.nodes[parentId] : null;
        return p && p.type !== "page" ? { x: p.x, y: p.y } : { x: 0, y: 0 };
    };
    const shift = (id, dx, dy) => {
        const n = snap.nodes[id];
        if (!n) return;
        snap.nodes[id] = Object.assign({}, n, { x: n.x + dx, y: n.y + dy });
        for (const c of n.children || []) shift(c, dx, dy);
    };
    const move = (id, dx, dy) => {
        if (!dx && !dy) return;
        shift(id, dx, dy);
        queue({ op: "move", id, dx, dy });
    };

    // Plugin data: private keys are "<plugin id>:<key>", shared ones "shared:<namespace>:<key>". An
    // empty value removes the key, as in the plugin API.
    const own = (key) => (manifest.id || "") + ":" + String(key);
    const shared = (namespace, key) => {
        if (!/^[A-Za-z0-9_.-]{3,}$/.test(String(namespace))) throw new Error("The namespace must be at least 3 alphanumeric characters.");
        return "shared:" + namespace + ":" + String(key);
    };
    const dataApi = {
        get: (holder, full) => (holder.pluginData || {})[full] || "",
        set(holder, full, value) {
            const next = Object.assign({}, holder.pluginData || {});
            if (value === "" || value == null) delete next[full];
            else next[full] = String(value);
            return next;
        },
        keys: (holder, prefix) => Object.keys(holder.pluginData || {}).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
    };
    // Relaunch data: { command: description }, only for commands the manifest lists as relaunch buttons.
    const relaunchPatch = (holder, data) => {
        const allowed = (manifest.relaunchButtons || []).map((b) => b.command);
        const clean = {};
        for (const [command, description] of Object.entries(data || {})) {
            if (!allowed.includes(command)) throw new Error("The command " + command + " isn't in the manifest's relaunchButtons.");
            clean[command] = String(description == null ? "" : description);
        }
        const next = Object.assign({}, holder.relaunchData || {});
        if (Object.keys(clean).length) next[manifest.id || ""] = clean;
        else delete next[manifest.id || ""];
        return next;
    };
    const docData = () => snap.docData || (snap.docData = { pluginData: {}, relaunchData: {} });
    const updateDoc = (patch) => {
        Object.assign(docData(), patch);
        queue({ op: "doc", patch });
    };

    class NagmaNode {
        constructor(id) { Object.defineProperty(this, "id", { value: id, enumerable: true }); }
        get __nagmaNode() { return true; }
        get type() { return TYPES[raw(this.id).type] || "FRAME"; }
        get removed() { return !snap.nodes[this.id]; }
        get name() { return raw(this.id).name; }
        set name(v) { update(this.id, { name: String(v) }); }
        get parent() { const p = raw(this.id).parentId; return p ? wrap(p) : (this.type === "PAGE" ? root : null); }
        get children() { return CONTAINERS.has(raw(this.id).type) ? raw(this.id).children.filter((c) => snap.nodes[c]).map(wrap) : undefined; }
        get x() { const n = raw(this.id); return n.x - origin(n.parentId).x; }
        set x(v) { const n = raw(this.id); move(this.id, Number(v) + origin(n.parentId).x - n.x, 0); }
        get y() { const n = raw(this.id); return n.y - origin(n.parentId).y; }
        set y(v) { const n = raw(this.id); move(this.id, 0, Number(v) + origin(n.parentId).y - n.y); }
        get width() { return raw(this.id).w; }
        get height() { return raw(this.id).h; }
        resize(w, h) { update(this.id, { w: Math.max(0.01, Number(w)), h: Math.max(0.01, Number(h)) }); }
        resizeWithoutConstraints(w, h) { this.resize(w, h); }
        get absoluteBoundingBox() { const n = raw(this.id); return { x: n.x, y: n.y, width: n.w, height: n.h }; }
        get absoluteTransform() { const n = raw(this.id); return [[1, 0, n.x], [0, 1, n.y]]; }
        get rotation() { return -(raw(this.id).rotation || 0); }
        set rotation(v) { update(this.id, { rotation: -Number(v) }); }
        get opacity() { return raw(this.id).opacity; }
        set opacity(v) { update(this.id, { opacity: Math.max(0, Math.min(1, Number(v))) }); }
        get visible() { return raw(this.id).visible; }
        set visible(v) { update(this.id, { visible: Boolean(v) }); }
        get locked() { return raw(this.id).locked; }
        set locked(v) { update(this.id, { locked: Boolean(v) }); }
        get fills() { return Object.freeze((raw(this.id).fills || []).map(toPaint)); }
        set fills(list) { update(this.id, { fills: Array.from(list).map(fromPaint) }); }
        get strokes() { return Object.freeze((raw(this.id).strokes || []).map(toPaint)); }
        set strokes(list) { update(this.id, { strokes: Array.from(list).map(fromPaint) }); }
        get strokeWeight() { return raw(this.id).strokeWidth; }
        set strokeWeight(v) { update(this.id, { strokeWidth: Math.max(0, Number(v)) }); }
        get strokeAlign() { return String(raw(this.id).strokeAlign || "inside").toUpperCase(); }
        set strokeAlign(v) { update(this.id, { strokeAlign: String(v).toLowerCase() }); }
        get cornerRadius() { const n = raw(this.id); return n.radii ? (n.radii.every((r) => r === n.radii[0]) ? n.radii[0] : Symbol.for("mixed")) : n.radius; }
        set cornerRadius(v) { update(this.id, { radius: Math.max(0, Number(v)), radii: null }); }
        get topLeftRadius() { const n = raw(this.id); return n.radii ? n.radii[0] : n.radius; }
        get topRightRadius() { const n = raw(this.id); return n.radii ? n.radii[1] : n.radius; }
        get bottomRightRadius() { const n = raw(this.id); return n.radii ? n.radii[2] : n.radius; }
        get bottomLeftRadius() { const n = raw(this.id); return n.radii ? n.radii[3] : n.radius; }
        get characters() { return raw(this.id).text == null ? undefined : raw(this.id).text; }
        set characters(v) { if (raw(this.id).type !== "text") throw new Error("Only text nodes have characters."); update(this.id, { text: String(v) }); }
        get fontSize() { return raw(this.id).fontSize; }
        set fontSize(v) { update(this.id, { fontSize: Math.max(1, Number(v)) }); }
        get fontName() { const n = raw(this.id); return n.type === "text" ? { family: n.fontFamily || "Inter", style: styleName(n) } : undefined; }
        set fontName(f) {
            const style = String(f.style || "Regular");
            const weight = weights[style.replace(/ ?Italic$/, "") || "Regular"] || 400;
            update(this.id, { fontFamily: String(f.family), fontWeight: weight, italic: /Italic/.test(style) });
        }
        get fontWeight() { return raw(this.id).fontWeight; }
        get textAlignHorizontal() { const a = raw(this.id).textAlign || "left"; return a === "justify" ? "JUSTIFIED" : a.toUpperCase(); }
        set textAlignHorizontal(v) { const a = String(v).toLowerCase(); update(this.id, { textAlign: a === "justified" ? "justify" : a }); }
        get letterSpacing() { return { value: raw(this.id).letterSpacing || 0, unit: "PIXELS" }; }
        get lineHeight() { const n = raw(this.id); return n.lineHeight == null ? { unit: "AUTO" } : { value: n.lineHeight * 100, unit: "PERCENT" }; }
        get layoutMode() { const l = raw(this.id).layout; return l ? (l.grid ? "GRID" : l.direction.toUpperCase()) : "NONE"; }
        set layoutMode(v) {
            const mode = String(v).toLowerCase();
            const cur = raw(this.id).layout;
            update(this.id, { layout: mode === "none" ? null : Object.assign({ gap: 0, padding: [0, 0, 0, 0], primary: "start", counter: "start" }, cur || {}, { direction: mode === "horizontal" ? "horizontal" : "vertical" }) });
        }
        get itemSpacing() { const l = raw(this.id).layout; return l ? l.gap : 0; }
        set itemSpacing(v) { const l = raw(this.id).layout; if (l) update(this.id, { layout: Object.assign({}, l, { gap: Number(v) }) }); }
        get paddingTop() { const l = raw(this.id).layout; return l ? l.padding[0] : 0; }
        get paddingRight() { const l = raw(this.id).layout; return l ? l.padding[1] : 0; }
        get paddingBottom() { const l = raw(this.id).layout; return l ? l.padding[2] : 0; }
        get paddingLeft() { const l = raw(this.id).layout; return l ? l.padding[3] : 0; }
        get primaryAxisAlignItems() { const l = raw(this.id).layout; return l ? ({ start: "MIN", center: "CENTER", end: "MAX", between: "SPACE_BETWEEN" })[l.primary] || "MIN" : "MIN"; }
        get counterAxisAlignItems() { const l = raw(this.id).layout; return l ? ({ start: "MIN", center: "CENTER", end: "MAX", baseline: "BASELINE" })[l.counter] || "MIN" : "MIN"; }
        get mainComponent() { const n = raw(this.id); return n.type === "instance" && n.componentId && snap.nodes[n.componentId] ? wrap(n.componentId) : null; }
        get description() { return raw(this.id).description || ""; }
        get devStatus() { const n = raw(this.id); return n.devStatus ? { type: ({ ready: "READY_FOR_DEV", completed: "COMPLETED", changed: "READY_FOR_DEV" })[n.devStatus], description: n.devStatusNote || undefined } : null; }
        appendChild(child) { this.insertChild(this.children ? this.children.length : 0, child); }
        insertChild(index, child) {
            if (!CONTAINERS.has(raw(this.id).type)) throw new Error("This node can't have children.");
            const c = raw(child.id);
            const old = c.parentId && snap.nodes[c.parentId];
            if (old) snap.nodes[old.id] = Object.assign({}, old, { children: old.children.filter((x) => x !== child.id) });
            const me = raw(this.id);
            const kids = me.children.filter((x) => x !== child.id);
            kids.splice(Math.max(0, Math.min(index, kids.length)), 0, child.id);
            snap.nodes[this.id] = Object.assign({}, me, { children: kids });
            snap.nodes[child.id] = Object.assign({}, c, { parentId: this.id });
            queue({ op: "reparent", id: child.id, parentId: this.id, index });
            // Its x and y stay the same relative to the new parent, as in the plugin API.
            const from = origin(c.parentId);
            const to = origin(this.id);
            move(child.id, to.x - from.x, to.y - from.y);
        }
        remove() {
            const n = raw(this.id);
            const p = n.parentId && snap.nodes[n.parentId];
            if (p) snap.nodes[p.id] = Object.assign({}, p, { children: p.children.filter((x) => x !== this.id) });
            delete snap.nodes[this.id];
            queue({ op: "delete", id: this.id });
        }
        clone() {
            const id = newId();
            queue({ op: "clone", id: this.id, newId: id });
            const n = raw(this.id);
            snap.nodes[id] = Object.assign({}, n, { id, children: [] });
            const p = n.parentId && snap.nodes[n.parentId];
            if (p) snap.nodes[p.id] = Object.assign({}, p, { children: p.children.concat(id) });
            return wrap(id);
        }
        findAll(cb) { const out = []; walk(this, (n) => { if (!cb || cb(n)) out.push(n); }); return out; }
        findOne(cb) { let found = null; walk(this, (n) => { if (!found && cb(n)) found = n; }); return found; }
        findChildren(cb) { return (this.children || []).filter((n) => !cb || cb(n)); }
        findChild(cb) { return (this.children || []).find(cb) || null; }
        findAllWithCriteria(c) { return this.findAll((n) => !c || !c.types || c.types.includes(n.type)); }
        getCSSAsync() { return ask("css", { id: this.id }); }
        exportAsync(settings) { return ask("export", { id: this.id, format: (settings && settings.format) || "PNG", scale: settings && settings.constraint && settings.constraint.type === "SCALE" ? settings.constraint.value : 1 }); }
        getPluginData(key) { return dataApi.get(raw(this.id), own(key)); }
        setPluginData(key, value) { update(this.id, { pluginData: dataApi.set(raw(this.id), own(key), value) }); }
        getPluginDataKeys() { return dataApi.keys(raw(this.id), own("")); }
        getSharedPluginData(namespace, key) { return dataApi.get(raw(this.id), shared(namespace, key)); }
        setSharedPluginData(namespace, key, value) { update(this.id, { pluginData: dataApi.set(raw(this.id), shared(namespace, key), value) }); }
        getSharedPluginDataKeys(namespace) { return dataApi.keys(raw(this.id), shared(namespace, "")); }
        getRelaunchData() { return Object.assign({}, (raw(this.id).relaunchData || {})[manifest.id || ""] || {}); }
        setRelaunchData(data) { update(this.id, { relaunchData: relaunchPatch(raw(this.id), data) }); }
        toString() { return "[Node " + this.id + "]"; }
    }
    const walk = (node, visit) => { for (const c of node.children || []) { visit(c); walk(c, visit); } };
    const wrap = (id) => {
        let w = wrappers.get(id);
        if (!w) { w = new NagmaNode(id); wrappers.set(id, w); }
        return w;
    };
    const newId = () => "p" + Math.random().toString(36).slice(2, 11);

    class PageNode extends NagmaNode {
        get selection() { return snap.pageId === this.id ? snap.selection.filter((id) => snap.nodes[id]).map(wrap) : []; }
        set selection(list) { snap.selection = Array.from(list).map((n) => n.id); queue({ op: "select", ids: snap.selection }); }
    }
    const root = {
        type: "DOCUMENT",
        id: "0:0",
        get name() { return snap.docName; },
        get children() { return snap.pageIds.map(page); },
        findAll(cb) { return this.children.flatMap((p) => p.findAll(cb)); },
        findOne(cb) { for (const p of this.children) { const f = p.findOne(cb); if (f) return f; } return null; },
        getPluginData(key) { return dataApi.get(docData(), own(key)); },
        setPluginData(key, value) { updateDoc({ pluginData: dataApi.set(docData(), own(key), value) }); },
        getPluginDataKeys() { return dataApi.keys(docData(), own("")); },
        getSharedPluginData(namespace, key) { return dataApi.get(docData(), shared(namespace, key)); },
        setSharedPluginData(namespace, key, value) { updateDoc({ pluginData: dataApi.set(docData(), shared(namespace, key), value) }); },
        getSharedPluginDataKeys(namespace) { return dataApi.keys(docData(), shared(namespace, "")); },
        getRelaunchData() { return Object.assign({}, (docData().relaunchData || {})[manifest.id || ""] || {}); },
        setRelaunchData(data) { updateDoc({ relaunchData: relaunchPatch(docData(), data) }); },
    };
    const page = (id) => {
        let w = wrappers.get(id);
        if (!(w instanceof PageNode)) { w = new PageNode(id); wrappers.set(id, w); }
        return w;
    };
    const lookup = (id) => (snap.nodes[id] ? (snap.nodes[id].type === "page" ? page(id) : wrap(id)) : null);

    const create = (type, overrides) => {
        const id = newId();
        const node = Object.assign({ id, type, parentId: snap.pageId, children: [], name: "", x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, visible: true, locked: false, fills: [], strokes: [], strokeWidth: 1, radius: 0, layout: null }, overrides);
        snap.nodes[id] = node;
        const p = snap.nodes[snap.pageId];
        if (p) snap.nodes[p.id] = Object.assign({}, p, { children: p.children.concat(id) });
        queue({ op: "create", nodeType: type, node });
        return wrap(id);
    };

    // ---- Widgets ----
    // A widget registers a function that returns its layers as elements (widget.h, or JSX with
    // widget.h as the pragma). Its state lives on the widget's layer and comes back on every run.
    let widgetFn = null;
    let widgetState = {};
    let widgetHandlers = [];
    const ELEMENTS = ["AutoLayout", "Frame", "Text", "Rectangle", "Ellipse", "Span"];
    const widget = {
        register(fn) { widgetFn = fn; },
        h(type, props, ...children) {
            if (typeof type === "function") return type(Object.assign({}, props, { children }));
            return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false && c !== true) };
        },
        useSyncedState(key, initial) {
            if (!Object.prototype.hasOwnProperty.call(widgetState, key)) widgetState[key] = typeof initial === "function" ? initial() : initial;
            return [widgetState[key], (v) => { widgetState[key] = typeof v === "function" ? v(widgetState[key]) : v; }];
        },
        useWidgetNodeId() { return snap.widgetNodeId || ""; },
    };
    for (const name of ELEMENTS) widget[name] = name;
    const serialize = (el) => {
        if (typeof el === "string" || typeof el === "number") return { type: "Text", props: {}, handler: null, text: String(el), children: [] };
        if (!el || typeof el !== "object") return null;
        const props = {};
        let handler = null;
        for (const [k, v] of Object.entries(el.props || {})) {
            if (k === "onClick" && typeof v === "function") handler = widgetHandlers.push(v) - 1;
            else if (k !== "children" && typeof v !== "function") props[k] = v;
        }
        const kids = el.children || [];
        if (el.type === "Text") return { type: "Text", props, handler, text: kids.map((c) => (c && typeof c === "object" ? (c.children || []).join("") : String(c))).join(""), children: [] };
        return { type: String(el.type), props, handler, children: kids.map(serialize).filter(Boolean) };
    };
    const renderWidget = () => {
        widgetHandlers = [];
        if (!widgetFn) throw new Error("This widget didn't call widget.register.");
        return serialize(widgetFn());
    };

    // ---- The global ----
    const ui = {
        postMessage(data) { flush(); send({ kind: "ui-post", data }); },
        set onmessage(fn) { uiHandler = fn; },
        get onmessage() { return uiHandler; },
        on(event, fn) { if (event === "message") uiListeners.push(fn); },
        off(event, fn) { const i = uiListeners.indexOf(fn); if (i >= 0) uiListeners.splice(i, 1); },
        show(html, options) { send({ kind: "ui-show", html: html == null ? globalThis.__html__ : String(html), options: options || {} }); },
        hide() { send({ kind: "ui-visible", visible: false }); },
        resize(width, height) { send({ kind: "ui-resize", width, height }); },
        reposition(x, y) { send({ kind: "ui-move", x, y }); },
        close() { send({ kind: "ui-close" }); },
    };
    const api = {
        get apiVersion() { return "1.0.0"; },
        get editorType() { return snap.editorType; },
        get mode() { return snap.mode; },
        get command() { return snap.command || ""; },
        get root() { return root; },
        get currentPage() { return page(snap.pageId); },
        set currentPage(p) { snap.pageId = p.id; queue({ op: "page", id: p.id }); },
        setCurrentPageAsync(p) { this.currentPage = p; return Promise.resolve(); },
        getNodeById: lookup,
        getNodeByIdAsync(id) { return Promise.resolve(lookup(id)); },
        createRectangle() { return create("rect", { name: "Rectangle", fills: [{ type: "solid", color: "#D9D9D9", opacity: 1, visible: true, blend: "normal" }] }); },
        createEllipse() { return create("ellipse", { name: "Ellipse", fills: [{ type: "solid", color: "#D9D9D9", opacity: 1, visible: true, blend: "normal" }] }); },
        createFrame() { return create("frame", { name: "Frame", fills: [{ type: "solid", color: "#FFFFFF", opacity: 1, visible: true, blend: "normal" }] }); },
        createText() { return create("text", { name: "Text", text: "", fontSize: 12, fontWeight: 400, fontFamily: "Inter", fills: [{ type: "solid", color: "#000000", opacity: 1, visible: true, blend: "normal" }], w: 1, h: 14 }); },
        loadFontAsync() { return Promise.resolve(); },
        group(nodes, parent) { flush(); return ask("group", { ids: nodes.map((n) => n.id), parentId: parent ? parent.id : null }).then((id) => lookup(id)); },
        notify(message, options) {
            send({ kind: "notify", message: String(message), error: Boolean(options && options.error), timeout: options && options.timeout });
            return { cancel() { send({ kind: "notify-cancel" }); } };
        },
        closePlugin(message) { flush(); send({ kind: "close", message: message == null ? null : String(message) }); },
        showUI(html, options) { ui.show(html, options); },
        ui,
        on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
        once(event, fn) { const wrapper = (...a) => { api.off(event, wrapper); return fn(...a); }; api.on(event, wrapper); },
        off(event, fn) { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },
        viewport: {
            scrollAndZoomIntoView(nodes) { queue({ op: "zoom", ids: Array.from(nodes).map((n) => n.id) }); },
        },
        clientStorage: {
            getAsync(key) { return ask("storage-get", { key }); },
            setAsync(key, value) { return ask("storage-set", { key, value }); },
            deleteAsync(key) { return ask("storage-set", { key, value: undefined }); },
            keysAsync() { return ask("storage-keys", {}); },
        },
        codegen: {
            on(event, fn) { if (event === "generate") listeners.generate = [fn]; else if (event === "preferenceschange") api.on(event, fn); },
            refresh() { send({ kind: "codegen-refresh" }); },
        },
        util: {
            rgb(hex) { return hexToRgb(hex); },
            solidPaint(hex) { return { type: "SOLID", color: hexToRgb(hex), opacity: 1, visible: true, blendMode: "NORMAL" }; },
        },
        mixed: Symbol.for("mixed"),
        widget,
    };
    Object.defineProperty(globalThis, "nagma", { value: api });
    // Plugins written before the rename use the old global.
    Object.defineProperty(globalThis, ${JSON.stringify(legacy.pluginGlobal)}, { value: api });

    addEventListener("message", async (event) => {
        if (event.source !== parent) return;
        const msg = event.data || {};
        if (msg.snapshot) {
            snap = Object.assign({}, snap, msg.snapshot);
        }
        if (msg.kind === "init") {
            manifest = msg.manifest || {};
            globalThis.__html__ = msg.html || "";
            globalThis.__uiFiles__ = msg.uiFiles || {};
            try {
                const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
                await new AsyncFunction(msg.code)();
                flush();
                send({ kind: "started" });
            } catch (e) {
                console.error(e && e.stack ? e.stack : String(e));
                send({ kind: "close", message: null, failed: true });
            }
        } else if (msg.kind === "response") {
            const r = requests.get(msg.id);
            requests.delete(msg.id);
            if (r) (msg.error ? r.reject(new Error(msg.error)) : r.resolve(msg.result));
        } else if (msg.kind === "ui-message") {
            if (uiHandler) try { uiHandler(msg.data, { origin: "null" }); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); }
            for (const fn of uiListeners) try { fn(msg.data, { origin: "null" }); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); }
            flush();
        } else if (msg.kind === "event") {
            emit(msg.event, ...(msg.args || []));
            flush();
        } else if (msg.kind === "widget-run") {
            // Render with the stored state; a click runs that element's handler and renders again.
            try {
                widgetState = Object.assign({}, msg.state || {});
                renderWidget();
                if (msg.handler != null && widgetHandlers[msg.handler]) await widgetHandlers[msg.handler]();
                flush();
                send({ kind: "widget-tree", id: msg.id, tree: renderWidget(), state: widgetState });
            } catch (e) {
                console.error(e && e.stack ? e.stack : String(e));
                send({ kind: "widget-tree", id: msg.id, error: String(e && e.message ? e.message : e) });
            }
        } else if (msg.kind === "generate") {
            const fn = (listeners.generate || [])[0];
            try {
                if (!fn) throw new Error("This plugin doesn't generate code.");
                const node = lookup(msg.nodeId);
                const result = await fn({ node, language: msg.language });
                const list = Array.isArray(result) ? result : [];
                send({ kind: "generated", id: msg.id, results: list.map((r) => ({ title: String(r.title || ""), code: String(r.code == null ? "" : r.code), language: String(r.language || "PLAINTEXT") })) });
            } catch (e) {
                console.error(e && e.stack ? e.stack : String(e));
                send({ kind: "generated", id: msg.id, error: String(e && e.message ? e.message : e) });
            }
        }
    });
    send({ kind: "ready" });
})();
`;

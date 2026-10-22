// End-to-end check for Nagma Capture: loads each page, runs the built page script
// (dist/capture.js) on it, hands the capture to the Nagma app the way the extension does (the
// hello / ready / capture messages), exports the imported top frame as a PNG and saves it next to
// a screenshot of the page at the same width.
//
//   python3 -m http.server <port> --directory apps/browser-extension/test/fixtures   (in another shell)
//   cd apps/desktop && npx electron ../browser-extension/test/run-fixtures.cjs \
//       --base http://127.0.0.1:<port>/ --out <dir> landing docs …
//
// Pages are names under --base (".html" added) or full URLs (--viewport for long, viewport-sized
// pages). --states also reads hover, press and focus looks (the page script's own fallback, with
// other origins' sheets fetched here as the service worker would) and saves, for each variant the
// import made, the page in that state (mouse over, pressed, focused) next to an export of the
// variant: <name>.state-<n>-<variant>.source.png / .nagma.png. The Nagma app is NAGMA_URL
// (http://localhost:5310/ by default, the web app's dev server). Both windows render offscreen
// in a throwaway session. Then compare the pairs with test/compare.py.

const { app, BrowserWindow, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const NAGMA = process.env.NAGMA_URL || "http://localhost:5310/";
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("run-fixtures.cjs")) + 1);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
};
const base = opt("base", "http://127.0.0.1:5733/");
const out = path.resolve(opt("out", "capture-out"));
const width = Number(opt("width", "1280"));
// --viewport: capture at the 800px window instead of growing it to the page's height first
// (for pages sized in viewport units, which grow with the window); the page shot is then the
// first screen.
const viewportOnly = args.includes("--viewport");
const withStates = args.includes("--states");
// --widths 1280,800,375: the page at each width (the first is the capture, the rest its
// breakpoints), opened as frames side by side, or with --site as a site; each width's frame is
// saved next to the page at that width: <name>-<width>.source.png / .nagma.png.
const widths = (opt("widths", "") || "").split(",").map(Number).filter((n) => n > 0);
const asSite = args.includes("--site");
// --live keeps interactive parts working (Live frames): each one is loaded on its own as Nagma runs
// it and pictured next to the page's part, before and after one interaction with it (the second
// tab, the next slide, a closed answer, the dialog's button, typing "ge"):
// <name>.live-<n>-<step>.source.png / .nagma.png.
const withLive = args.includes("--live");
// --still pauses the page's CSS animations before it's captured and pictured, so a page that keeps
// moving (drifting shapes) is compared at one moment.
const still = args.includes("--still");
const pages = args.filter((a) => !a.startsWith("--"));
const SCRIPT = fs.readFileSync(path.resolve(__dirname, "../dist/capture.js"), "utf8");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
if (app.dock) app.dock.hide();
// Windows come and go between pages; the run ends when the pages are done, not before.
app.on("window-all-closed", () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWindow(partition, w, h) {
    return new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, backgroundColor: "#ffffff", webPreferences: { offscreen: true, partition, backgroundThrottling: false } });
}

async function shotPage(name, url) {
    const win = makeWindow(`cap-src-${process.pid}`, width, 800);
    await win.loadURL(url);
    await win.webContents.executeJavaScript("document.fonts.ready.then(() => Promise.all(Array.from(document.images).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))))", true);
    // Real pages fade their loaders and settle their fonts for a while.
    await sleep(/^https?:/.test(url) && !url.startsWith(base) ? 4000 : 400);
    const height = await win.webContents.executeJavaScript("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)", true);
    const h = viewportOnly ? 800 : Math.min(Math.max(800, height), 8000);
    if (h !== 800) {
        win.setContentSize(width, h);
        await sleep(600);
    }
    if (still) await win.webContents.executeJavaScript("document.getAnimations().forEach((a) => a.pause()); true", true);
    await win.webContents.executeJavaScript(SCRIPT, true);
    let options = { inlineAssets: true, live: withLive };
    if (withStates || withLive) {
        const hrefs = await win.webContents.executeJavaScript("window.__nagmaUnreadableSheets()", true);
        const sheets = [];
        for (const href of hrefs) {
            const res = await fetch(href).catch(() => null);
            if (res && res.ok) sheets.push({ href, text: await res.text() });
        }
        options = { ...options, ...(withStates ? { states: "rules" } : {}), sheets };
    }
    const result = await win.webContents.executeJavaScript(`window.__nagmaCapture(${JSON.stringify(options)})`, true);
    await attachFonts(result.capture);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.source.png`), image.toPNG());
    // What the page couldn't read (another origin's video frame, an embedded page) cropped from the
    // screen, as the service worker does with the visible tab.
    for (const p of result.pending.filter((p) => !p.url)) {
        const b = p.box;
        const crop = image.crop({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.w)), height: Math.max(1, Math.round(b.h)) });
        const entry = result.capture.assets[p.id];
        if (entry) {
            entry.data = `data:image/png;base64,${crop.toPNG().toString("base64")}`;
            entry.bitmap = true;
        }
    }
    result.pending = result.pending.filter((p) => p.url);
    if (withLive) await inlineLiveUrls(result.capture);
    fs.writeFileSync(path.join(out, `${name}.capture.json`), JSON.stringify(result.capture));
    if (withStates || withLive) result.win = win;
    else win.destroy();
    return result;
}

// A Live frame's pictures and fonts as data, as the service worker does (inlineLiveUrls).
async function inlineLiveUrls(capture) {
    const read = async (url) => {
        const res = await fetch(url).catch(() => null);
        if (!res || !res.ok) return "data:,";
        const type = (res.headers.get("content-type") || "").split(";")[0];
        return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    };
    const visit = async (n) => {
        if (n.live) {
            const patterns = [
                ["css", /url\(\s*["']?([^"')]+)["']?\s*\)/g],
                ["html", /\s(?:src|poster)="([^"]+)"/g],
                // Pictures in style attributes (their quotes written as &quot;).
                ["html", /url\(\s*(?:&quot;|["'])?([^"')&]+)(?:&quot;|["'])?\s*\)/g],
            ];
            for (const [key, re] of patterns) {
                for (const m of [...n.live[key].matchAll(re)]) if (/^https?:/.test(m[1])) n.live[key] = n.live[key].split(m[1]).join(await read(m[1]));
            }
        }
        for (const c of n.children) await visit(c);
    };
    await visit(capture.root);
}

// One interaction per pattern, on the part's root element (R).
const ACTIONS = {
    tabs: "(R) => { const t = R.querySelectorAll('[role=tab]')[1]; if (!t) return null; t.click(); return 'second-tab'; }",
    carousel: "(R) => { const b = [...R.querySelectorAll('button, [role=button], a')].find((b) => /next|›|→/i.test((b.getAttribute('aria-label') || '') + b.textContent)); if (!b) return null; b.click(); return 'next'; }",
    accordion: "(R) => { const b = R.querySelector('[aria-expanded=false]'); if (!b) return null; b.click(); return 'expand'; }",
    dialog: "(R) => { const b = R.querySelector('[data-dialog], [aria-haspopup=dialog], [data-target], [data-bs-target], [data-open], [data-modal]'); if (!b) return null; b.click(); return 'open'; }",
    autocomplete: "(R) => { const i = R.querySelector('[role=combobox], input[aria-autocomplete]'); if (!i) return null; i.focus(); i.value = 'ge'; i.dispatchEvent(new Event('input', { bubbles: true })); return 'type'; }",
};

const LIVE_DOCS = `(async () => {
  const { liveDocument } = await import("/src/engine/live.ts");
  const doc = window.nagma.get().doc;
  return Object.values(doc.nodes).filter((n) => n.type === "live").map((n) => ({ name: n.name, path: (n.pluginData || {})["capture:path"], w: Math.round(n.w), h: Math.round(n.h), html: liveDocument(doc, n) }));
})()`;

// Each Live frame as Nagma runs it (its own window), next to the page's part, before and after.
async function shootLive(name, win, capture, lives) {
    let n = 0;
    for (const live of lives) {
        const node = live.path ? findByPath(capture.root, live.path) : null;
        if (!node || !node.live) continue;
        const b = node.box;
        const at = await win.webContents.executeJavaScript(RESOLVE(live.path), true);
        if (!at || b.y + b.h > win.getContentSize()[1] || b.x + b.w > win.getContentSize()[0]) continue;
        const frame = makeWindow(`cap-live-${process.pid}`, live.w, live.h);
        const file = path.join(out, `${name}.live-${n}.html`);
        fs.writeFileSync(file, live.html);
        await frame.loadFile(file);
        await frame.webContents.executeJavaScript("document.fonts.ready", true);
        await sleep(500);
        const shoot = async (step) => {
            const src = await win.webContents.capturePage({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) });
            const dst = await frame.webContents.capturePage({ x: 0, y: 0, width: live.w, height: live.h });
            fs.writeFileSync(path.join(out, `${name}.live-${n}-${step}.source.png`), src.toPNG());
            fs.writeFileSync(path.join(out, `${name}.live-${n}-${step}.nagma.png`), dst.toPNG());
        };
        await shoot("before");
        const pattern = node.live.pattern.split(" ")[0];
        const act = ACTIONS[pattern];
        if (act) {
            const a = await win.webContents.executeJavaScript(`(${act})(window.__stateEl)`, true);
            const b2 = await frame.webContents.executeJavaScript(`(${act})(document.querySelector("[data-nl-root]"))`, true);
            await sleep(900);
            if (a && b2) await shoot(a);
        }
        frame.destroy();
        n++;
    }
    return n;
}

// The page's font files, read as the service worker reads them (fetchFonts in background.ts).
async function attachFonts(capture) {
    let n = 0;
    for (const font of capture.fonts || []) {
        for (const face of font.faces || []) {
            if (!/^(https?|data):/.test(face.url)) continue;
            const res = await fetch(face.url).catch(() => null);
            if (!res || !res.ok) continue;
            const bytes = Buffer.from(await res.arrayBuffer());
            const type = { woff2: "font/woff2", woff: "font/woff", truetype: "font/ttf", opentype: "font/otf" }[face.format] || "font/woff2";
            const id = `f${++n}`;
            capture.assets[id] = { url: face.url, data: `data:${type};base64,${bytes.toString("base64")}` };
            face.asset = id;
        }
    }
}

// Each variant of each component set, exported at its own box.
const VARIANTS = `(async () => {
  const { renderExport } = await import("/src/engine/export.ts");
  const { preloadImages } = await import("/src/engine/image-store.ts");
  const doc = window.nagma.get().doc;
  await preloadImages(doc.images);
  await document.fonts.ready;
  const out = [];
  for (const set of Object.values(doc.nodes).filter((n) => n.type === "componentSet")) {
    for (const id of set.children) {
      const v = doc.nodes[id];
      const f = await renderExport(doc, id, { format: "png", scale: 1, suffix: "", contentsOnly: false });
      const blob = f.blob ?? f.data ?? f;
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out.push({ set: set.name, variant: v.name.replace("State=", ""), path: (v.pluginData || {})["capture:path"], png: btoa(s), w: v.w, h: v.h });
    }
  }
  return out;
})()`;

// The element at a capture path ("body>main:0>div:1>button#save"), in the page.
const RESOLVE = (p) => `(() => {
  let el = document.body;
  for (const step of ${JSON.stringify(p)}.split(">").slice(1)) {
    const m = /^([a-z0-9-]+)(?:#(.+)|:(\\d+))$/.exec(step);
    if (!m || !el) return null;
    el = m[2] ? el.querySelector(":scope > #" + CSS.escape(m[2])) : Array.from(el.children).filter((c) => c.tagName.toLowerCase() === m[1])[Number(m[3])];
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  window.__stateEl = el;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() };
})()`;

function findByPath(node, p) {
    if (node.path === p) return node;
    for (const c of node.children) {
        const f = findByPath(c, p);
        if (f) return f;
    }
    return null;
}

// The page in each variant's state, cropped to the box the capture recorded for that state.
async function shootStates(name, win, capture, variants) {
    let n = 0;
    for (const v of variants) {
        const state = { Default: null, Hover: "hover", Pressed: "active", Focused: "focus" }[v.variant];
        const node = v.path ? findByPath(capture.root, v.path) : null;
        const look = state ? node?.states?.[state] : node;
        const at = v.path ? await win.webContents.executeJavaScript(RESOLVE(v.path), true) : null;
        // Only what the window shows (a --viewport page is cut at its first screen).
        if (!look || !at || look.box.y + look.box.h > win.getContentSize()[1] || look.box.x + look.box.w > win.getContentSize()[0]) continue;
        const wc = win.webContents;
        if (state === "hover" || state === "active") wc.sendInputEvent({ type: "mouseMove", x: Math.round(at.x), y: Math.round(at.y) });
        if (state === "active") wc.sendInputEvent({ type: "mouseDown", x: Math.round(at.x), y: Math.round(at.y), button: "left", clickCount: 1 });
        if (state === "focus") await wc.executeJavaScript("window.__stateEl.focus({ focusVisible: true })", true);
        await sleep(600);
        const b = look.box;
        const img = await wc.capturePage({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) });
        const file = `${name}.state-${n}-${v.variant}`;
        fs.writeFileSync(path.join(out, `${file}.source.png`), img.toPNG());
        fs.writeFileSync(path.join(out, `${file}.nagma.png`), Buffer.from(v.png, "base64"));
        n++;
        if (state === "active") wc.sendInputEvent({ type: "mouseUp", x: Math.round(at.x), y: Math.round(at.y), button: "left", clickCount: 1 });
        wc.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
        await wc.executeJavaScript("document.activeElement && document.activeElement.blur()", true);
        await sleep(400);
    }
    return n;
}

let appWin = null;
async function nagmaWindow() {
    if (appWin) return appWin;
    nativeTheme.themeSource = "light";
    appWin = makeWindow(`cap-app-${process.pid}-${Date.now()}`, 1440, 900);
    appWin.webContents.on("console-message", (e) => {
        const level = e.level ?? e.params?.level;
        if (level === "error" || level === 3) console.log("[app]", String(e.message ?? e.params?.message).slice(0, 300));
    });
    await appWin.loadURL(NAGMA).catch((e) => console.log("load:", e.message));
    for (let i = 0; i < 100; i++) {
        if (await appWin.webContents.executeJavaScript("Boolean(window.nagma)", true)) break;
        await sleep(200);
    }
    await sleep(1500);
    return appWin;
}

// The extension's hand-over, run in the app's page: hello until ready, then the capture.
const HANDOVER = (json) => `new Promise((resolve) => {
  const capture = ${json};
  let stage = "hello";
  const before = window.nagma.get().fileId;
  const on = (e) => {
    if (e.source !== window) return;
    if (e.data?.type === "nagma-capture-ready" && stage === "hello") { stage = "sent"; window.postMessage({ type: "nagma-capture", capture }, location.origin); }
    else if (e.data?.type === "nagma-capture-received") { stage = "done"; window.removeEventListener("message", on); resolve(before); }
  };
  window.addEventListener("message", on);
  const t = setInterval(() => { if (stage !== "hello") return clearInterval(t); window.postMessage({ type: "nagma-capture-hello" }, location.origin); }, 200);
  window.postMessage({ type: "nagma-capture-hello" }, location.origin);
})`;

const EXPORT = `(async () => {
  const { renderExport } = await import("/src/engine/export.ts");
  const { preloadImages } = await import("/src/engine/image-store.ts");
  const doc = window.nagma.get().doc;
  await preloadImages(doc.images);
  await document.fonts.ready;
  const page = doc.nodes[doc.roots[0]];
  const frameId = page.children[0];
  const f = await renderExport(doc, frameId, { format: "png", scale: 1, suffix: "" });
  const blob = f.blob ?? f.data ?? f;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const nodes = Object.values(doc.nodes);
  const count = (p) => nodes.filter(p).length;
  return { png: btoa(s), stats: { layers: nodes.length, sets: count((n) => n.type === "componentSet"), live: count((n) => n.type === "live"), frames: count((n) => n.type === "frame"), text: count((n) => n.type === "text"), autoLayout: count((n) => n.layout), components: count((n) => n.type === "component"), instances: count((n) => n.type === "instance" && !n.sourceId), vectors: count((n) => n.type === "vector"), images: Object.keys(doc.images).length, name: doc.nodes[frameId].name, w: doc.nodes[frameId].w, h: doc.nodes[frameId].h } };
})()`;

// The page at several widths: one capture with the others as its breakpoints.
async function shotWidths(name, url) {
    let main = null;
    const breakpoints = [];
    for (const [i, w] of widths.entries()) {
        const win = makeWindow(`cap-src-${process.pid}`, w, 800);
        await win.loadURL(url);
        await win.webContents.executeJavaScript("document.fonts.ready", true);
        await sleep(400);
        const height = await win.webContents.executeJavaScript("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)", true);
        if (height > 800) {
            win.setContentSize(w, Math.min(height, 8000));
            await sleep(600);
        }
        await win.webContents.executeJavaScript(SCRIPT, true);
        const result = await win.webContents.executeJavaScript(`window.__nagmaCapture(${JSON.stringify({ inlineAssets: true, assetPrefix: i ? `b${i}-` : "a" })})`, true);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(out, `${name}-${w}.source.png`), image.toPNG());
        win.destroy();
        const c = result.capture;
        if (!main) {
            main = c;
            main.label = ["Desktop", "Tablet", "Phone"][i] || String(w);
        } else {
            Object.assign(main.assets, c.assets);
            breakpoints.push({ label: ["Desktop", "Tablet", "Phone"][i] || String(w), width: w, viewport: c.viewport, scroll: c.scroll, background: c.background, root: c.root });
        }
    }
    main.breakpoints = breakpoints;
    await attachFonts(main);
    fs.writeFileSync(path.join(out, `${name}.capture.json`), JSON.stringify(main));
    return { capture: main, pending: [] };
}

// Each width's frame (side by side, or the site's breakpoint frames), exported.
const WIDTH_FRAMES = `(async () => {
  const { renderExport } = await import("/src/engine/export.ts");
  const { preloadImages } = await import("/src/engine/image-store.ts");
  const s = window.nagma.get();
  const doc = s.doc;
  await preloadImages(doc.images);
  await document.fonts.ready;
  const page = doc.nodes[s.pageId] || doc.nodes[doc.roots[0]];
  const out = [];
  for (const id of page.children) {
    const f = doc.nodes[id];
    if (!f || f.type !== "frame") continue;
    const file = await renderExport(doc, id, { format: "png", scale: 1, suffix: "" });
    const blob = file.blob ?? file.data ?? file;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let str = ""; for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    out.push({ name: f.name, w: Math.round(f.w), h: Math.round(f.h), png: btoa(str) });
  }
  const nodes = Object.values(doc.nodes);
  return { frames: out, site: Boolean(doc.site), copies: nodes.filter((n) => n.site && n.site.src).length, hidden: nodes.filter((n) => n.site && n.site.src && n.visible === false).length, layers: nodes.length };
})()`;

async function importIntoNagma(name, capture) {
    const win = await nagmaWindow();
    const before = await win.webContents.executeJavaScript(HANDOVER(JSON.stringify(capture)), true);
    if (capture.breakpoints && capture.breakpoints.length) {
        // The opener asks how to open several widths.
        for (let i = 0; i < 100; i++) {
            const clicked = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('[data-choice="${asSite ? "site" : "frames"}"]'); if (b) b.click(); return Boolean(b); })()`, true);
            if (clicked) break;
            await sleep(100);
        }
    }
    for (let i = 0; i < 150; i++) {
        const id = await win.webContents.executeJavaScript("window.nagma.get().fileId", true);
        if (id && id !== before) break;
        await sleep(200);
    }
    await sleep(2500);
    if (capture.breakpoints && capture.breakpoints.length) {
        const res = await win.webContents.executeJavaScript(WIDTH_FRAMES, true);
        for (const f of res.frames) {
            const w = /(\d+)$/.exec(f.name)?.[1] ?? String(f.w);
            fs.writeFileSync(path.join(out, `${name}-${asSite ? f.w : w}.nagma.png`), Buffer.from(f.png, "base64"));
        }
        return { frames: res.frames.map((f) => `${f.name} ${f.w}x${f.h}`), site: res.site, copies: res.copies, hidden: res.hidden, layers: res.layers };
    }
    const res = await win.webContents.executeJavaScript(EXPORT, true);
    fs.writeFileSync(path.join(out, `${name}.nagma.png`), Buffer.from(res.png, "base64"));
    return res.stats;
}

app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const summary = {};
    for (const p of pages) {
        const name = /^https?:/.test(p) ? new URL(p).hostname.replace(/\W+/g, "-") : p;
        const url = /^https?:/.test(p) ? p : `${base}${p}.html`;
        try {
            const { capture, pending, win } = widths.length > 1 ? await shotWidths(name, url) : await shotPage(name, url);
            const stats = await importIntoNagma(name, capture);
            summary[name] = { ...stats, unreadAssets: pending.length };
            if (win) {
                if (withLive) {
                    const lives = await (await nagmaWindow()).webContents.executeJavaScript(LIVE_DOCS, true);
                    summary[name].liveFrames = lives.map((l) => l.name);
                    summary[name].livePairs = await shootLive(name, win, capture, lives);
                }
                if (withStates) {
                    const variants = await (await nagmaWindow()).webContents.executeJavaScript(VARIANTS, true);
                    summary[name].stateSets = new Set(variants.map((v) => v.set)).size;
                    summary[name].statePairs = await shootStates(name, win, capture, variants);
                }
                win.destroy();
            }
            console.log(name, JSON.stringify(summary[name]));
        } catch (e) {
            console.log(name, "FAILED", e && e.stack ? e.stack : e);
            summary[name] = { error: String(e) };
        }
    }
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    app.exit(0);
});

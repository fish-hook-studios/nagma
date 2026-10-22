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
// pages). The Nagma app is NAGMA_URL
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
    await win.webContents.executeJavaScript(SCRIPT, true);
    const result = await win.webContents.executeJavaScript("window.__nagmaCapture({ inlineAssets: true })", true);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.source.png`), image.toPNG());
    fs.writeFileSync(path.join(out, `${name}.capture.json`), JSON.stringify(result.capture));
    win.destroy();
    return result;
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
  return { png: btoa(s), stats: { layers: nodes.length, frames: count((n) => n.type === "frame"), text: count((n) => n.type === "text"), autoLayout: count((n) => n.layout), components: count((n) => n.type === "component"), instances: count((n) => n.type === "instance" && !n.sourceId), vectors: count((n) => n.type === "vector"), images: Object.keys(doc.images).length, name: doc.nodes[frameId].name, w: doc.nodes[frameId].w, h: doc.nodes[frameId].h } };
})()`;

async function importIntoNagma(name, capture) {
    const win = await nagmaWindow();
    const before = await win.webContents.executeJavaScript(HANDOVER(JSON.stringify(capture)), true);
    for (let i = 0; i < 150; i++) {
        const id = await win.webContents.executeJavaScript("window.nagma.get().fileId", true);
        if (id && id !== before) break;
        await sleep(200);
    }
    await sleep(2500);
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
            const { capture, pending } = await shotPage(name, url);
            const stats = await importIntoNagma(name, capture);
            summary[name] = { ...stats, unreadAssets: pending.length };
            console.log(name, JSON.stringify(summary[name]));
        } catch (e) {
            console.log(name, "FAILED", e && e.stack ? e.stack : e);
            summary[name] = { error: String(e) };
        }
    }
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    app.exit(0);
});

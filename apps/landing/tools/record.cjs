// Records a short loop of the real Nagma web app for the marketing site.
//
//   cd apps/desktop && npx electron ../landing/tools/record.cjs <scene.cjs> <name> [--keep]
//   cd apps/desktop && npx electron ../landing/tools/record.cjs --serve [port]
//
// It loads the web app's dev server (http://localhost:5310/, `cd apps/web && npx vite --port 5310
// --strictPort`) in an offscreen window (nothing appears on screen), runs the scene and writes
// img/<name>.mp4, img/<name>.webm and img/<name>.jpg next to the landing page.
//
// A scene module exports `async function (page)`; `page` has:
//   js(code)                run code in the page, returns its value
//   rect(query) / el(query) find an element by CSS selector, or by text with "text=Board",
//                           "label=Close" (aria-label or title); returns {x, y, w, h, cx, cy} or null
//   waitFor(query, ms)      wait until rect(query) finds something
//   move(x, y, ms)          move the mouse there smoothly (eased, interpolated)
//   click(x, y) / clickEl(query)
//   drag(x1, y1, x2, y2, ms)
//   type(text, msPerChar) / key(name, modifiers)
//   wait(ms)
//   zoom(x, y, scale, ms)   ease the whole page (a CSS transform on <html>) to `scale`, bringing the
//                           point (x, y) toward the middle; unzoom(ms) eases back to 1. Pass
//                           { wait: false } as the last argument to move the mouse meanwhile.
//   start() / stop()        begin and end the recorded span (only that span is encoded)
//   mark(name)              remember the current time (poster: page.poster = "name")
//   shot(file)              save a PNG of the current frame (for exploring)
//   opts                    { duration, fade, poster, crf } overrides for encoding
//   extraWindow(url)        another person: an offscreen window with its own session, not recorded
//
// The window renders offscreen, which draws no mouse pointer, so the page gets a small pointer
// overlay that follows the mouse (an arrow, or a crosshair where the app shows one).
//
// Coordinates in scenes are always the page's own (unzoomed) CSS pixels in a 1280x800 viewport:
// rect() returns them and move()/click()/drag() take them, mapping through the current zoom. The
// window is 1440x900 with the page zoomed 1.125x, so frames are 1440x900 with the same layout.
//
// --serve opens the app and listens on 127.0.0.1:<port> (default 5319): POST a scene body (the
// inside of an async function with `page` in scope) and get back its result as JSON. For exploring.

const { app, BrowserWindow, nativeTheme } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const URL = process.env.NAGMA_URL || "http://localhost:5310/";
const FFMPEG = process.env.FFMPEG || (fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const W = 1280;
const H = 800;
// Rendered (and encoded) size: a 1440x900 window with the page zoomed 1.125x, so the layout is
// still 1280x800 CSS pixels. Input events take window pixels (CSS pixels x 1.125).
const DSF = 1.125;
const CW = Math.round(W * DSF);
const CH = Math.round(H * DSF);
const FPS = 24;
const OUT_DIR = path.resolve(__dirname, "../img");
const MAX_MP4 = 600 * 1024;

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
if (app.dock) app.dock.hide();

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("record.cjs")) + 1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// cubic-bezier(.2,.7,.2,1), the zoom's CSS timing function, to know the scale mid-transition.
const ZOOM_CURVE = "cubic-bezier(.2,.7,.2,1)";
function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const fx = (t) => ((ax * t + bx) * t + cx) * t;
    const fy = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
        let lo = 0, hi = 1, t = x;
        for (let i = 0; i < 30; i++) {
            t = (lo + hi) / 2;
            if (fx(t) < x) lo = t;
            else hi = t;
        }
        return fy(t);
    };
}
const zoomEase = bezier(0.2, 0.7, 0.2, 1);

// The pointer overlay, injected into the page. It follows real mouse events, so it is exactly
// where the app thinks the mouse is.
const CURSOR_JS = `(() => {
  window.__recMatrix = () => { const cs = getComputedStyle(document.documentElement); const o = cs.transformOrigin.split(" ").map(parseFloat); return new DOMMatrix().translate(o[0], o[1]).multiply(new DOMMatrix(cs.transform)).translate(-o[0], -o[1]); };
  if (window.__recCursor) return;
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;transition:none;display:none";
  const arrow = '<svg width="20" height="22" viewBox="0 0 20 22" style="position:absolute;left:-2px;top:-1px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))"><path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const cross = '<svg width="22" height="22" viewBox="0 0 22 22" style="position:absolute;left:-11px;top:-11px"><path d="M11 2v18M2 11h18" stroke="#fff" stroke-width="3"/><path d="M11 2v18M2 11h18" stroke="#111" stroke-width="1.2"/></svg>';
  const hand = '<svg width="22" height="22" viewBox="0 0 24 24" style="position:absolute;left:-8px;top:-2px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-.5V3.5a1.5 1.5 0 0 1 3 0V10m0-5a1.5 1.5 0 0 1 3 0v7c0 4.5-2.5 8-7 8-3 0-4.5-1.5-6.5-4.5L3 13c-.7-1.2.9-2.6 2-1.6L9 15" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  const text = '<svg width="12" height="22" viewBox="0 0 12 22" style="position:absolute;left:-6px;top:-11px"><path d="M2 2h3l1 1 1-1h3M6 3v16M2 20h3l1-1 1 1h3" fill="none" stroke="#fff" stroke-width="3"/><path d="M2 2h3l1 1 1-1h3M6 3v16M2 20h3l1-1 1 1h3" fill="none" stroke="#111" stroke-width="1.2"/></svg>';
  let shape = "";
  const set = (s) => { if (s !== shape) { shape = s; el.innerHTML = s === "crosshair" ? cross : s === "pointer" ? hand : s === "text" ? text : arrow; } };
  set("default");
  // The overlay lives inside <html>, which the zoom scales, so it is placed in the page's own
  // coordinates (the pointer's position mapped back through the live transform) and scales too.
  // Placed by the recorder instead (see page.anchor): page coordinates and the window point.
  window.__recCursorAt = (x, y, sx, sy) => {
    el.style.display = "block";
    el.style.transform = "translate(" + x + "px," + y + "px)";
    const t = document.elementFromPoint(sx, sy);
    let c = "default";
    try { c = t ? getComputedStyle(t).cursor : "default"; } catch {}
    set(/crosshair|cell/.test(c) ? "crosshair" : /pointer/.test(c) ? "pointer" : /^text|vertical-text/.test(c) ? "text" : "default");
  };
  const place = (e) => {
    if (window.__recCursorManual) return;
    el.style.display = "block";
    const m = window.__recMatrix();
    const p = m.inverse().transformPoint(new DOMPoint(e.clientX, e.clientY));
    el.style.transform = "translate(" + p.x + "px," + p.y + "px)";
    const t = document.elementFromPoint(e.clientX, e.clientY);
    let c = "default";
    try { c = t ? getComputedStyle(t).cursor : "default"; } catch {}
    if (window.__recCursorForce) c = window.__recCursorForce;
    set(/crosshair|cell/.test(c) ? "crosshair" : /pointer/.test(c) ? "pointer" : /^text|vertical-text/.test(c) ? "text" : "default");
  };
  addEventListener("pointermove", place, true);
  addEventListener("pointerdown", place, true);
  addEventListener("mousemove", place, true);
  const attach = () => document.documentElement.appendChild(el);
  attach();
  new MutationObserver(() => { if (el.parentNode !== document.documentElement || el.nextSibling) attach(); }).observe(document.documentElement, { childList: true });
  window.__recCursor = el;
})()`;

// Finds an element in the page: CSS selector, "text=…" (exact visible text, then prefix), or
// "label=…" (aria-label / title). Only visible elements count; the last match wins for text so
// menus that open on top are preferred.
// The page's live transform (the zoom), origin included.
const MATRIX_JS = `window.__recMatrix = () => { const cs = getComputedStyle(document.documentElement); const o = cs.transformOrigin.split(" ").map(parseFloat); return new DOMMatrix().translate(o[0], o[1]).multiply(new DOMMatrix(cs.transform)).translate(-o[0], -o[1]); };`;
const RECT_JS = `${MATRIX_JS} window.__recRect = (e) => {
  const r = e.getBoundingClientRect();
  const m = window.__recMatrix().inverse();
  const a = m.transformPoint(new DOMPoint(r.left, r.top));
  const b = m.transformPoint(new DOMPoint(r.right, r.bottom));
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
};`;
const FIND_JS = (q, all) => `(() => {
  ${RECT_JS}
  const q = ${JSON.stringify(q)};
  const vis = (e) => { const r = window.__recRect(e); r.bottom = r.y + r.h; r.right = r.x + r.w; r.top = r.y; r.left = r.x; r.width = r.w; r.height = r.h; if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.01 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  let els = [];
  if (q.startsWith("text=")) {
    const t = q.slice(5).trim().toLowerCase();
    const cands = [...document.querySelectorAll("body *")].filter((e) => vis(e));
    const txt = (e) => (e.innerText || e.textContent || "").trim().toLowerCase().replace(/\\s+/g, " ");
    els = cands.filter((e) => txt(e) === t);
    // Prefer the innermost match.
    els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
    if (!els.length) els = cands.filter((e) => txt(e).startsWith(t) && ![...e.children].some((c) => txt(c).startsWith(t)));
  } else if (q.startsWith("label=")) {
    const t = q.slice(6).trim().toLowerCase();
    els = [...document.querySelectorAll("[aria-label],[title]")].filter((e) => vis(e) && ((e.getAttribute("aria-label") || e.getAttribute("title") || "").trim().toLowerCase() === t));
  } else {
    els = [...document.querySelectorAll(q)].filter(vis);
  }
  const out = els.map((e) => { const r = window.__recRect(e); return { ...r, tag: e.tagName.toLowerCase(), text: (e.innerText || "").trim().slice(0, 60), label: e.getAttribute("aria-label") || e.getAttribute("title") || "" }; });
  return ${all ? "out" : "out[out.length - 1] || null"};
})()`;

function makePage(win, rec) {
    const wc = win.webContents;
    const mouse = { x: W / 2, y: H / 2, down: false };
    const mods = (m) => (m ? (Array.isArray(m) ? m : [m]) : []);
    // The zoom: scale z.s0 → z.s1 about (z.ox, z.oy) over z.ms from z.t0.
    const z = { s0: 1, s1: 1, ox: 0, oy: 0, t0: 0, ms: 0 };
    const scaleNow = () => (z.ms && Date.now() - z.t0 < z.ms ? z.s0 + (z.s1 - z.s0) * zoomEase((Date.now() - z.t0) / z.ms) : z.s1);
    // Page coordinates to window coordinates, and back.
    const toScreen = (x, y) => {
        const k = scaleNow();
        return { x: z.ox + (x - z.ox) * k, y: z.oy + (y - z.oy) * k };
    };
    // Anchored (page.anchor): the window point keeps the page point's offset from the anchor's
    // top-left unscaled, which is what code computing `clientX - rect.left` expects (canvases,
    // sliders, drag handles), and the pointer overlay is placed by hand where the page point is.
    let anchor = null;
    const send = (ev) => {
        if (ev.x !== undefined) {
            const lx = ev.x;
            const ly = ev.y;
            let p = toScreen(lx, ly);
            if (anchor) {
                const a = toScreen(anchor.x, anchor.y);
                p = { x: a.x + (lx - anchor.x), y: a.y + (ly - anchor.y) };
                const t = toScreen(lx, ly);
                wc.executeJavaScript(`window.__recCursorAt && window.__recCursorAt(${lx}, ${ly}, ${t.x}, ${t.y})`, true).catch(() => {});
            }
            ev = { ...ev, x: Math.round(p.x * DSF), y: Math.round(p.y * DSF) };
        }
        wc.sendInputEvent(ev);
    };
    const page = {
        win,
        wc,
        opts: {},
        marks: {},
        js: (code) => wc.executeJavaScript(code, true),
        // Page-coordinate rect of the first element matching a CSS selector (or null).
        layoutRect: (sel) => wc.executeJavaScript(`(() => { ${RECT_JS} const e = document.querySelector(${JSON.stringify(sel)}); return e ? window.__recRect(e) : null; })()`, true),
        // Anchor the pointer to an element (a CSS selector, or a page-coordinate point {x, y});
        // null goes back to plain mapping. See `send` above.
        async anchor(target) {
            if (!target) {
                anchor = null;
                await wc.executeJavaScript("window.__recCursorManual = false", true);
                return;
            }
            anchor = typeof target === "string" ? await page.layoutRect(target) : target;
            if (!anchor) throw new Error(`anchor: nothing matches ${target}`);
            await wc.executeJavaScript("window.__recCursorManual = true", true);
        },
        async zoom(x, y, scale, ms = 750, { wait = true } = {}) {
            // The origin that puts (x, y) as near the middle as the page's edges allow (the page
            // always covers the window): o + (p - o) * s = c  →  o = (p * s - c) / (s - 1).
            const origin = (p, c, max) => Math.max(0, Math.min(max, (p * scale - c) / (scale - 1)));
            z.s0 = 1;
            z.s1 = scale;
            z.ox = origin(x, W / 2, W);
            z.oy = origin(y, H / 2, H);
            z.t0 = Date.now();
            z.ms = ms;
            await wc.executeJavaScript(`(() => { const h = document.documentElement; h.style.transition = "none"; h.style.transformOrigin = "${z.ox}px ${z.oy}px"; h.style.overflow = "hidden"; void h.offsetWidth; h.style.transition = "transform ${ms}ms ${ZOOM_CURVE}"; h.style.transform = "scale(${scale})"; })()`, true);
            z.t0 = Date.now();
            if (wait) await sleep(ms + 30);
        },
        async unzoom(ms = 750, { wait = true } = {}) {
            z.s0 = scaleNow();
            z.s1 = 1;
            z.t0 = Date.now();
            z.ms = ms;
            await wc.executeJavaScript(`(() => { const h = document.documentElement; h.style.transition = "transform ${ms}ms ${ZOOM_CURVE}"; h.style.transform = "scale(1)"; })()`, true);
            z.t0 = Date.now();
            if (wait) {
                await sleep(ms + 30);
                await wc.executeJavaScript(`(() => { const h = document.documentElement; h.style.transition = ""; h.style.transform = ""; h.style.transformOrigin = ""; h.style.overflow = ""; })()`, true);
            }
        },
        wait: sleep,
        async rect(q) {
            return wc.executeJavaScript(FIND_JS(q, false), true);
        },
        async all(q) {
            return wc.executeJavaScript(FIND_JS(q, true), true);
        },
        async waitFor(q, ms = 8000) {
            const end = Date.now() + ms;
            for (;;) {
                const r = await page.rect(q);
                if (r) return r;
                if (Date.now() > end) throw new Error(`waitFor: nothing matches ${q}`);
                await sleep(100);
            }
        },
        async move(x, y, ms = 450, modifiers) {
            const x0 = mouse.x;
            const y0 = mouse.y;
            const steps = Math.max(1, Math.round(ms / 16));
            // A slight arc so the path doesn't look ruler-straight.
            const bend = Math.min(40, Math.hypot(x - x0, y - y0) * 0.08);
            const nx = -(y - y0) / (Math.hypot(x - x0, y - y0) || 1);
            const ny = (x - x0) / (Math.hypot(x - x0, y - y0) || 1);
            for (let i = 1; i <= steps; i++) {
                const t = ease(i / steps);
                const b = Math.sin(Math.PI * t) * bend;
                mouse.x = x0 + (x - x0) * t + nx * b;
                mouse.y = y0 + (y - y0) * t + ny * b;
                const m = [...mods(modifiers), ...(mouse.down ? ["leftButtonDown"] : [])];
                send({ type: "mouseMove", x: Math.round(mouse.x), y: Math.round(mouse.y), modifiers: m, ...(mouse.down ? { button: "left" } : {}) });
                await sleep(ms / steps);
            }
            mouse.x = x;
            mouse.y = y;
        },
        async down(modifiers) {
            mouse.down = true;
            send({ type: "mouseDown", x: Math.round(mouse.x), y: Math.round(mouse.y), button: "left", clickCount: 1, modifiers: mods(modifiers) });
            await sleep(30);
        },
        async up(modifiers) {
            mouse.down = false;
            send({ type: "mouseUp", x: Math.round(mouse.x), y: Math.round(mouse.y), button: "left", clickCount: 1, modifiers: mods(modifiers) });
            await sleep(30);
        },
        async click(x, y, { ms = 450, modifiers, count = 1, pause = 90 } = {}) {
            if (x !== undefined) await page.move(x, y, ms);
            await sleep(pause);
            for (let c = 1; c <= count; c++) {
                send({ type: "mouseDown", x: Math.round(mouse.x), y: Math.round(mouse.y), button: "left", clickCount: c, modifiers: mods(modifiers) });
                await sleep(60);
                send({ type: "mouseUp", x: Math.round(mouse.x), y: Math.round(mouse.y), button: "left", clickCount: c, modifiers: mods(modifiers) });
                await sleep(60);
            }
        },
        async clickEl(q, o = {}) {
            const r = await page.waitFor(q, o.timeout ?? 8000);
            await page.click(r.cx + (o.dx || 0), r.cy + (o.dy || 0), o);
            return r;
        },
        async drag(x1, y1, x2, y2, ms = 700, modifiers, approach = 300) {
            await page.move(x1, y1, approach);
            await sleep(60);
            await page.down(modifiers);
            await page.move(x2, y2, ms, modifiers);
            await sleep(80);
            await page.up(modifiers);
        },
        async key(name, modifiers) {
            const m = mods(modifiers);
            send({ type: "keyDown", keyCode: name, modifiers: m });
            if (name.length === 1 && !m.some((x) => /cmd|meta|control|ctrl|alt/i.test(x))) send({ type: "char", keyCode: m.includes("shift") ? name.toUpperCase() : name, modifiers: m });
            await sleep(40);
            send({ type: "keyUp", keyCode: name, modifiers: m });
            await sleep(40);
        },
        async type(text, msPerChar = 70) {
            for (const ch of text) {
                if (ch === "\n") {
                    await page.key("Enter");
                } else {
                    const shift = ch !== ch.toLowerCase();
                    send({ type: "keyDown", keyCode: ch, modifiers: shift ? ["shift"] : [] });
                    send({ type: "char", keyCode: ch, modifiers: shift ? ["shift"] : [] });
                    send({ type: "keyUp", keyCode: ch, modifiers: shift ? ["shift"] : [] });
                }
                await sleep(msPerChar * (0.6 + Math.random() * 0.8));
            }
        },
        async scroll(x, y, dy, dx = 0, modifiers) {
            await page.move(x, y, 300);
            send({ type: "mouseWheel", x: Math.round(x), y: Math.round(y), deltaX: -dx, deltaY: -dy, canScroll: true, modifiers: mods(modifiers) });
            await sleep(50);
        },
        mouse,
        start: () => rec.start(),
        stop: () => rec.stop(),
        mark: (n) => (page.marks[n] = rec.elapsed()),
        async shot(file) {
            const img = await wc.capturePage();
            fs.writeFileSync(file, img.toPNG());
            return file;
        },
    };
    return page;
}

// Frames: the offscreen window paints into `latest`; a 24 fps clock writes whatever is latest
// (repeating it when nothing changed) to ffmpeg, which keeps a near-lossless intermediate.
function makeRecorder(win, file) {
    let latest = null;
    let ff = null;
    let t0 = 0;
    let written = 0;
    let timer = null;
    let size = null;
    win.webContents.on("paint", (_e, _dirty, image) => {
        latest = image;
    });
    const tick = () => {
        if (!ff || !latest) return;
        const due = Math.floor(((Date.now() - t0) * FPS) / 1000) + 1;
        if (due <= written) return;
        let img = latest;
        const s = img.getSize();
        if (s.width !== CW || s.height !== CH) img = img.resize({ width: CW, height: CH });
        const buf = img.toBitmap();
        while (written < due) {
            ff.stdin.write(buf);
            written++;
        }
    };
    return {
        start() {
            if (ff) return;
            ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${CW}x${CH}`, "-r", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-pix_fmt", "yuv444p", file], { stdio: ["pipe", "inherit", "inherit"] });
            t0 = Date.now();
            written = 0;
            timer = setInterval(tick, 1000 / FPS / 2);
        },
        elapsed: () => (t0 ? (Date.now() - t0) / 1000 : 0),
        async stop() {
            if (!ff) return;
            tick();
            clearInterval(timer);
            const p = new Promise((r) => ff.on("close", r));
            ff.stdin.end();
            await p;
            ff = null;
        },
        frames: () => written,
    };
}

function run(cmd, a) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, a, { stdio: ["ignore", "inherit", "inherit"] });
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`))));
    });
}

async function encode(raw, name, total, opts) {
    // Real time by default (maxSpeed 1): a capture longer than the loop loses its start. A scene
    // may allow a slight speed-up with maxSpeed (at most 1.2x).
    const want = opts.duration || total;
    const speed = opts.speed ?? (total > want && total / want <= Math.min(1.2, opts.maxSpeed ?? 1) ? total / want : 1);
    const duration = Math.min(want, total / speed);
    const start = +Math.max(0, opts.trimStart ?? total - duration * speed).toFixed(4);
    // The page holds the last frame before it restarts the loop, so by default there is no
    // crossfade; fade > 0 blends the tail into the first frame instead.
    const fade = opts.fade ?? 0;
    const loopFilter = fade > 0 ? `[0:v]trim=start=${start}:duration=${duration * speed},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},split[a][b];[b]trim=end_frame=1,loop=loop=${Math.ceil(fade * FPS) + 2}:size=1,setpts=N/${FPS}/TB[first];[a]split[main][tail];[main]trim=end=${duration - fade},setpts=PTS-STARTPTS[head];[tail]trim=start=${duration - fade},setpts=PTS-STARTPTS[t2];[t2][first]blend=all_expr='A*(1-T/${fade})+B*(T/${fade})':shortest=1[x];[head][x]concat=n=2:v=1[o];[o]` : `[0:v]trim=start=${start}:duration=${duration * speed},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},`;
    const scale = `scale=${CW}:${CH}:flags=lanczos,format=yuv420p`;
    const filter = fade > 0 ? `${loopFilter}${scale}[v]` : `${loopFilter}${scale}[v]`;
    const mp4 = path.join(OUT_DIR, `${name}.mp4`);
    const webm = path.join(OUT_DIR, `${name}.webm`);
    const jpg = path.join(OUT_DIR, `${name}.jpg`);
    let crf = opts.crf ?? 27;
    for (;;) {
        await run(FFMPEG, ["-y", "-loglevel", "error", "-i", raw, "-filter_complex", filter, "-map", "[v]", "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
        if (fs.statSync(mp4).size <= MAX_MP4 || crf >= 33) break;
        crf += 1;
    }
    let webmCrf = opts.webmCrf ?? 40;
    for (;;) {
        await run(FFMPEG, ["-y", "-loglevel", "error", "-i", raw, "-filter_complex", filter, "-map", "[v]", "-r", String(FPS), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(webmCrf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", webm]);
        if (fs.statSync(webm).size <= MAX_MP4 * 1.1 || webmCrf >= 50) break;
        webmCrf += 3;
    }
    const posterAt = Math.max(0, Math.min(duration - fade - 0.1, opts.posterMark !== undefined ? (opts.posterMark - start) / speed + (opts.posterDelay ?? 0.8) : (opts.posterAt ?? duration * 0.7)));
    // The poster comes from the near-lossless capture, at the same moment.
    await run(FFMPEG, ["-y", "-loglevel", "error", "-ss", String((start + posterAt * speed).toFixed(3)), "-i", raw, "-frames:v", "1", "-vf", "format=yuvj444p", "-q:v", "5", jpg]);
    return { mp4, webm, jpg, crf, webmCrf, duration, start, speed };
}

async function openApp() {
    const win = new BrowserWindow({
        show: false,
        width: CW,
        height: CH,
        useContentSize: true,
        backgroundColor: "#ffffff",
        // An in-memory session: a fresh device every run (Get started shows, no old drafts).
        webPreferences: { offscreen: true, partition: `rec-${process.pid}-${Date.now()}`, backgroundThrottling: false },
    });
    win.webContents.setFrameRate(30);
    win.webContents.setZoomFactor(DSF);
    win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(DSF));
    win.webContents.on("console-message", (e) => {
        const level = e.level ?? e.params?.level;
        if (level === "error" || level === 3) console.log("[page]", e.message ?? e.params?.message);
    });
    // Light theme: the app follows the system appearance when asked to, and the system here is light.
    nativeTheme.themeSource = "light";
    await win.loadURL(URL);
    await win.webContents.executeJavaScript('localStorage.setItem("nagma.theme.system.v1", "1")', true);
    await win.loadURL(URL);
    // A hidden window never has focus, so the page would see no focus or blur events (fields
    // that save on blur would never save). Emulate a focused page.
    try {
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    } catch (e) {
        console.warn("focus emulation unavailable:", e.message);
    }

    await win.webContents.executeJavaScript(CURSOR_JS, true);
    win.webContents.on("did-finish-load", () => win.webContents.executeJavaScript(CURSOR_JS, true).catch(() => {}));
    win.webContents.on("did-navigate-in-page", () => win.webContents.executeJavaScript(CURSOR_JS, true).catch(() => {}));
    win.webContents.focus();
    return win;
}

// Another person: an offscreen window with its own session (so its own identity) on `url`, driven
// like the main one but not recorded. For multiplayer scenes; closed when the recording ends.
async function extraWindow(url, list) {
    const w = new BrowserWindow({
        show: false,
        width: CW,
        height: CH,
        useContentSize: true,
        backgroundColor: "#ffffff",
        webPreferences: { offscreen: true, partition: `rec-extra-${process.pid}-${Date.now()}-${list.length}`, backgroundThrottling: false },
    });
    list.push(w);
    w.webContents.setFrameRate(10);
    w.webContents.setZoomFactor(DSF);
    w.webContents.on("did-finish-load", () => w.webContents.setZoomFactor(DSF));
    await w.loadURL(url);
    try {
        w.webContents.debugger.attach("1.3");
        await w.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    } catch {}
    const p = makePage(w, { start() {}, stop() {}, elapsed: () => 0 });
    p.ready = () => ready(p);
    return p;
}

// Shared first steps: wait for Home and close Get started.
async function ready(page) {
    await page.waitFor("text=Drafts", 30000);
    await sleep(600);
    const close = await page.rect('[aria-label="Get started with Nagma"] [aria-label="Close"]');
    if (close) {
        await page.click(close.cx, close.cy, { ms: 1 });
        await sleep(400);
    }
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
    await page.move(W - 200, H - 150, 1);
}

async function main() {
    await app.whenReady();
    if (args[0] === "--serve") {
        const port = Number(args[1] || 5319);
        const win = await openApp();
        const rawFile = path.join(require("node:os").tmpdir(), `rec-serve-${process.pid}.mkv`);
        const rec = makeRecorder(win, rawFile);
        const page = makePage(win, rec);
        page.ready = () => ready(page);
        page.extras = [];
        page.extraWindow = (url) => extraWindow(url, page.extras);
        http.createServer((req, res) => {
            let body = "";
            req.on("data", (d) => (body += d));
            req.on("end", async () => {
                try {
                    if (body.trim() === "quit") {
                        res.end("bye");
                        app.quit();
                        return;
                    }
                    const fn = new Function("page", "sleep", "require", `return (async () => { ${body} })()`);
                    const out = await fn(page, sleep, require);
                    res.end(JSON.stringify(out ?? null, null, 1));
                } catch (e) {
                    res.statusCode = 500;
                    res.end(String(e && e.stack ? e.stack : e));
                }
            });
        }).listen(port, "127.0.0.1", () => console.log(`serving on 127.0.0.1:${port}`));
        return;
    }
    const [sceneFile, name] = args;
    if (!sceneFile || !name) throw new Error("usage: record.cjs <scene.cjs> <name>");
    const scene = require(path.resolve(sceneFile));
    const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "nagma-rec-"));
    const raw = path.join(tmp, "raw.mkv");
    const win = await openApp();
    const rec = makeRecorder(win, raw);
    const page = makePage(win, rec);
    page.ready = () => ready(page);
    page.extraWindow = (url) => extraWindow(url, page.extras);
    page.extras = [];
    await ready(page);
    try {
        await scene(page);
    } finally {
        await rec.stop();
        for (const w of page.extras) if (!w.isDestroyed()) w.destroy();
    }
    const total = rec.frames() / FPS;
    const opts = { ...(scene.opts || {}), ...page.opts };
    opts.posterMark = opts.posterMark ? page.marks[opts.posterMark] : undefined;
    console.log(`captured ${total.toFixed(2)} s`);
    const out = await encode(raw, name, total, opts);
    for (const f of [out.mp4, out.webm, out.jpg]) console.log(`${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
    console.log(`duration ${out.duration.toFixed(2)} s (from ${out.start.toFixed(2)} s, speed ${out.speed.toFixed(2)}x), mp4 crf ${out.crf}, webm crf ${out.webmCrf}`);
    if (!args.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
    else console.log(`raw: ${raw}`);
    app.quit();
}

main().catch((e) => {
    console.error(e);
    app.exit(1);
});

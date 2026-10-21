// Records short screen-capture loops of the real Nagma web app for the marketing site.
//
// Usage (from apps/desktop, which has Electron):
//   npx electron ../landing/tools/record2.cjs <scene> [--probe]
//
// Loads http://127.0.0.1:5320/ (the web app's Vite dev server) in an offscreen 1280x800 window
// with a fresh profile, runs ../landing/tools/scenes2/<scene>.cjs, captures frames with
// webContents.capturePage() while the scene calls rec.start()..rec.stop(), then encodes
// apps/landing/img/<scene>.mp4 (H.264), <scene>.webm (VP9) and <scene>.jpg (poster).
// Offscreen windows draw no OS cursor, so a pointer overlay is drawn into the page at the
// position of the synthetic mouse. --probe skips encoding (for writing scenes).

const { app, BrowserWindow, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const scene = process.argv.find((a, i) => i > 1 && !a.startsWith("-") && !a.endsWith(".cjs"));
const probe = process.argv.includes("--probe");
if (!scene) {
    console.error("usage: electron record2.cjs <scene> [--probe]");
    process.exit(1);
}
const URL = process.env.NAGMA_URL || "http://127.0.0.1:5320/";
const W = 1280;
const H = 800;
const FFMPEG = process.env.FFMPEG || "/opt/homebrew/bin/ffmpeg";
const OUT = path.resolve(__dirname, "../img");
const work = fs.mkdtempSync(path.join(process.env.RECORD_TMP || os.tmpdir(), `rec-${scene}-`));
const framesDir = path.join(work, "frames");
fs.mkdirSync(framesDir);
app.setPath("userData", path.join(work, "profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The pointer drawn into the page: an arrow, or an I-beam over text fields.
const CURSOR_JS = `(() => {
  if (window.__recCursor) return;
  const el = document.createElement('div');
  el.id = '__rec_cursor';
  el.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px);';
  const arrow = '<svg width="20" height="24" viewBox="0 0 20 24"><path d="M2 1.5v18.2l4.6-4.4 3 6.9 3.1-1.3-3-6.8h6.4z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const beam = '<svg width="20" height="24" viewBox="-6 0 20 24"><path d="M1 2h2.5M5.5 2H3.5M3.5 2v20M1 22h5" stroke="#fff" stroke-width="3.2" fill="none"/><path d="M1 2h5M3.5 2v20M1 22h5" stroke="#111" stroke-width="1.4" fill="none"/></svg>';
  const hand = '<svg width="22" height="24" viewBox="0 0 22 24"><path d="M7 11V3.5a1.6 1.6 0 0 1 3.2 0V10h.3V8.3a1.6 1.6 0 0 1 3.2 0V10h.2V9a1.6 1.6 0 0 1 3.2 0v1.2h.1a1.6 1.6 0 0 1 3.1.5V16c0 4-2.6 6.6-6.4 6.6h-1.5c-2.3 0-3.7-.9-5-2.6L2.6 15a1.7 1.7 0 0 1 2.6-2.1L7 14.5z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  el.innerHTML = arrow;
  let kind = 'arrow';
  window.__recCursor = (x, y) => {
    el.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 1) + 'px)';
    if (!el.isConnected) document.documentElement.appendChild(el);
    const t = document.elementFromPoint(x, y);
    let c = t ? getComputedStyle(t).cursor : 'default';
    const k = c === 'text' ? 'beam' : c === 'pointer' ? 'hand' : 'arrow';
    if (k !== kind) { kind = k; el.innerHTML = k === 'beam' ? beam : k === 'hand' ? hand : arrow; el.style.transform = 'translate(' + (x - (k==='beam'?4:k==='hand'?7:2)) + 'px,' + (y - (k==='hand'?2:1)) + 'px)'; }
  };
  window.__recCursorHide = () => { el.style.transform = 'translate(-100px,-100px)'; };
  document.documentElement.appendChild(el);
})()`;

async function main() {
    // Never hang around: a stuck run exits on its own.
    setTimeout(() => {
        console.error("record2: timed out");
        quit(2);
    }, Number(process.env.REC_TIMEOUT || 240000));
    if (app.dock) app.dock.hide();
    await app.whenReady();
    const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
    win.webContents.setFrameRate(30);
    win.webContents.on("console-message", (e) => {
        const level = e.level ?? "";
        if (process.env.REC_VERBOSE || level === "error") console.log("[page]", level, e.message);
    });
    // Light theme: the app follows the system appearance, and this window's system is light.
    nativeTheme.themeSource = "light";
    await win.loadURL(URL);
    const wc = win.webContents;
    await wc.executeJavaScript(`localStorage.setItem("nagma.theme.system.v1", "1")`);
    await win.loadURL(URL);
    // An offscreen window has no OS focus; without page focus, fields never see focus/blur.
    wc.focus();
    try {
        wc.debugger.attach("1.3");
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    } catch (e) {
        console.error("focus emulation failed", e.message);
    }
    // A hidden offscreen window only produces frames (and so runs requestAnimationFrame, which
    // popovers and menus wait on) when something asks for one: keep asking.
    const pump = setInterval(() => wc.invalidate(), 33);
    const js = (code) => wc.executeJavaScript(code, true);
    const pos = { x: W / 2, y: H / 2 };
    let buttons = []; // held mouse buttons, for drags
    const ensureCursor = () => js(CURSOR_JS).catch(() => {});
    const moveCursor = (x, y) => js(`window.__recCursor && window.__recCursor(${x},${y})`).catch(() => {});

    const sendMove = (x, y) => {
        wc.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y), button: buttons[0], modifiers: buttons.length ? [`${buttons[0]}ButtonDown`] : [] });
    };
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    // Smooth, slightly curved human-ish move.
    async function move(x, y, ms) {
        await ensureCursor();
        const dx = x - pos.x;
        const dy = y - pos.y;
        const dist = Math.hypot(dx, dy);
        const dur = ms ?? Math.min(900, Math.max(220, dist * 1.1));
        const steps = Math.max(2, Math.round(dur / 16));
        const bend = (Math.random() - 0.5) * 0.12 * dist;
        const nx = dist ? -dy / dist : 0;
        const ny = dist ? dx / dist : 0;
        const sx = pos.x;
        const sy = pos.y;
        for (let i = 1; i <= steps; i++) {
            const t = ease(i / steps);
            const arc = Math.sin(Math.PI * t) * bend;
            const px = sx + dx * t + nx * arc;
            const py = sy + dy * t + ny * arc;
            sendMove(px, py);
            moveCursor(px, py);
            await sleep(dur / steps);
        }
        pos.x = x;
        pos.y = y;
        sendMove(x, y);
        await moveCursor(x, y);
    }
    async function down(button = "left", modifiers = []) {
        buttons = [button];
        wc.sendInputEvent({ type: "mouseDown", x: Math.round(pos.x), y: Math.round(pos.y), button, clickCount: 1, modifiers });
        await sleep(60);
    }
    async function up(button = "left", modifiers = []) {
        wc.sendInputEvent({ type: "mouseUp", x: Math.round(pos.x), y: Math.round(pos.y), button, clickCount: 1, modifiers });
        buttons = [];
        await sleep(40);
    }
    async function click(x, y, opts = {}) {
        if (x !== undefined) await move(x, y, opts.ms);
        await sleep(opts.pause ?? 90);
        await down(opts.button, opts.modifiers);
        await sleep(40);
        await up(opts.button, opts.modifiers);
        if (opts.double) {
            await sleep(60);
            wc.sendInputEvent({ type: "mouseDown", x: Math.round(pos.x), y: Math.round(pos.y), button: "left", clickCount: 2 });
            await sleep(30);
            wc.sendInputEvent({ type: "mouseUp", x: Math.round(pos.x), y: Math.round(pos.y), button: "left", clickCount: 2 });
        }
        await sleep(80);
    }
    async function dblclick(x, y) {
        await click(x, y, { double: true });
    }
    async function drag(x1, y1, x2, y2, ms = 700, modifiers = []) {
        await move(x1, y1);
        await sleep(80);
        await down("left", modifiers);
        await sleep(80);
        // move in small steps so drag thresholds trigger
        const steps = Math.max(8, Math.round(ms / 16));
        for (let i = 1; i <= steps; i++) {
            const t = ease(i / steps);
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            wc.sendInputEvent({ type: "mouseMove", x: Math.round(px), y: Math.round(py), button: "left", modifiers: ["leftButtonDown", ...modifiers] });
            moveCursor(px, py);
            await sleep(ms / steps);
        }
        pos.x = x2;
        pos.y = y2;
        await sleep(120);
        await up("left", modifiers);
    }
    const KEYCODES = { enter: "Return", esc: "Escape", escape: "Escape", backspace: "Backspace", tab: "Tab", space: "Space", delete: "Delete", up: "Up", down: "Down", left: "Left", right: "Right" };
    async function key(name, modifiers = []) {
        const keyCode = KEYCODES[name.toLowerCase()] || name;
        wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        if (keyCode.length === 1 && !modifiers.some((m) => m === "cmd" || m === "meta" || m === "control" || m === "ctrl" || m === "alt")) wc.sendInputEvent({ type: "char", keyCode, modifiers });
        await sleep(30);
        wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
        await sleep(60);
    }
    async function type(text, perChar = 70) {
        for (const ch of text) {
            if (ch === "\n") {
                await key("enter");
                continue;
            }
            const shift = /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(ch);
            const mods = shift ? ["shift"] : [];
            wc.sendInputEvent({ type: "keyDown", keyCode: ch === " " ? "Space" : ch, modifiers: mods });
            wc.sendInputEvent({ type: "char", keyCode: ch, modifiers: mods });
            wc.sendInputEvent({ type: "keyUp", keyCode: ch === " " ? "Space" : ch, modifiers: mods });
            await sleep(perChar * (0.6 + Math.random() * 0.8));
        }
    }
    const wait = (ms) => sleep(ms);
    // Center of the first element matching a selector, or of an element whose text matches.
    async function rect(selector, text) {
        return js(`(() => {
            const want = ${JSON.stringify(text ?? null)};
            const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
            const el = want == null ? els[0] : els.find(e => (e.getAttribute('aria-label') || '') === want || e.textContent.trim() === want) || els.find(e => (e.getAttribute('aria-label') || '').includes(want) || e.textContent.trim().includes(want));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, w: r.width, h: r.height };
        })()`);
    }
    async function waitFor(selector, text, timeout = 8000) {
        const t0 = Date.now();
        for (;;) {
            const r = await rect(selector, text);
            if (r) return r;
            if (Date.now() - t0 > timeout) throw new Error(`waitFor timed out: ${selector} ${text ?? ""}`);
            await sleep(100);
        }
    }
    async function clickOn(selector, text, opts) {
        const r = await waitFor(selector, text);
        await click(r.x, r.y, opts);
        return r;
    }
    let shotN = 0;
    async function shot(name) {
        const img = await wc.capturePage();
        const f = path.join(work, `shot-${String(++shotN).padStart(2, "0")}-${name}.png`);
        fs.writeFileSync(f, img.toPNG());
        console.log("shot", f);
        return f;
    }

    // Frame capture loop.
    let recording = false;
    const frames = []; // { file, t }
    let loop = null;
    let posterIndex = null;
    async function captureLoop() {
        let n = 0;
        while (recording) {
            const t = Date.now();
            try {
                const img = await wc.capturePage();
                const file = path.join(framesDir, `f${String(n++).padStart(5, "0")}.png`);
                fs.writeFileSync(file, img.toPNG());
                frames.push({ file, t });
            } catch (e) {
                console.error("capture failed", e.message);
            }
            const spent = Date.now() - t;
            await sleep(Math.max(0, 50 - spent));
        }
    }
    const rec = {
        start() {
            if (recording) return;
            recording = true;
            loop = captureLoop();
        },
        async stop() {
            recording = false;
            await loop;
        },
        poster() {
            posterIndex = frames.length - 1;
        },
    };

    const api = { win, wc, js, move, click, dblclick, drag, down, up, key, type, wait, rect, waitFor, clickOn, shot, rec, pos, W, H, ensureCursor, hideCursor: () => js("window.__recCursorHide && window.__recCursorHide()") };
    const sceneFile = path.resolve(__dirname, "scenes2", `${scene}.cjs`);
    const run = require(sceneFile);
    await sleep(1500);
    await ensureCursor();
    const info = await run(api);
    if (recording) await rec.stop();
    console.log(`work dir: ${work}`);
    if (probe || frames.length < 2) {
        console.log(`probe done (${frames.length} frames)`);
        quit(0);
        return;
    }
    // Real timestamps -> concat list with per-frame durations.
    const lines = ["ffconcat version 1.0"];
    for (let i = 0; i < frames.length; i++) {
        const d = i < frames.length - 1 ? (frames[i + 1].t - frames[i].t) / 1000 : 0.5;
        lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(3)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    const list = path.join(work, "list.txt");
    fs.writeFileSync(list, lines.join("\n"));
    const total = (frames[frames.length - 1].t - frames[0].t) / 1000 + 0.5;
    console.log(`${frames.length} frames over ${total.toFixed(2)} s (${(frames.length / total).toFixed(1)} fps captured)`);
    const name = (info && info.name) || scene;
    const vf = "scale=960:600:flags=lanczos,fps=24,format=yuv420p";
    const crf = String((info && info.crf) || 26);
    const mp4 = path.join(OUT, `${name}.mp4`);
    const webm = path.join(OUT, `${name}.webm`);
    const jpg = path.join(OUT, `${name}.jpg`);
    const ff = (args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-tune", "animation", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
    ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(Number(crf) + 10), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-an", webm]);
    const pf = frames[posterIndex ?? frames.length - 1].file;
    ff(["-i", pf, "-vf", "scale=960:600:flags=lanczos", "-q:v", "3", jpg]);
    for (const f of [mp4, webm, jpg]) console.log(f, `${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
    quit(0);
}

// Quit hard: with the debugger attached to an offscreen window, app.exit() and process.exit()
// can hang in teardown. Everything is written synchronously by now, so just end the process.
const quit = (code) => {
    if (code) console.error(`record2: exit ${code}`);
    process.kill(process.pid, "SIGKILL");
};

main().catch((e) => {
    console.error(e);
    console.log(`work dir: ${work}`);
    quit(1);
});

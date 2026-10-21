// Make: ?new=make; zoomed in on the composer, a prompt typed and sent; zoomed in on the chat
// while it plans and writes the five files; back out as the preview renders the app ("amma.",
// Balan's search journal from the handoff: the film still, three remembered places, a memory map
// and the names she used), then "Places" in the app's bottom bar opens the memory map, and the loop
// rests there. Needs the web app's dev server started with VITE_MAKE_DEMO=1 (a staged answer, no
// AI key); the app's files (assets/amma/app) and pictures are handed to the page before the prompt.
//
// The preview is a sandboxed frame the offscreen window doesn't route mouse input into, so the
// pointer clicks "Places" where it is and the same click is dispatched on the button inside the frame.
const { openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

const A = path.join(__dirname, "assets", "amma");
const read = (p) => fs.readFileSync(path.join(A, p), "utf8");
const b64 = (p, type) => `data:${type};base64,` + fs.readFileSync(path.join(A, p)).toString("base64");
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
// src/assets.ts: the pictures as data URLs, the decor and icons as SVG text.
const assets = [
    "export const ART = {",
    ...["mother-and-son", "old-house", "school", "tea-shop", "floral-sprig"].map((k) => `  ${camel(k === "floral-sprig" ? "sprig" : k)}: ${JSON.stringify(b64(k + ".webp", "image/webp"))},`),
    "};",
    "export const DECOR = {",
    `  mapBase: ${JSON.stringify(read("memory-map-base.svg"))},`,
    `  mapRoute: ${JSON.stringify(read("memory-route.svg"))},`,
    `  torn: ${JSON.stringify(read("torn-edge.svg"))},`,
    `  tornDiagonal: ${JSON.stringify(read("torn-edge-diagonal.svg"))},`,
    "};",
    "export const ICON = {",
    ...fs.readdirSync(path.join(A, "icons")).filter((f) => f.endsWith(".svg")).map((f) => `  ${camel(f.replace(".svg", ""))}: ${JSON.stringify(read("icons/" + f))},`),
    "};",
    "",
].join("\n");
const FILES = {
    "index.html": read("app/index.html"),
    "src/main.tsx": read("app/src/main.tsx"),
    "src/App.tsx": read("app/src/App.tsx"),
    "src/styles.css": read("app/src/styles.css"),
    "src/assets.ts": assets,
};
const REPLY = "Here's amma., Balan's search journal: a home with the one photo he has and the search to continue, a memory map of the places they lived with what he remembers at each, the names she used in each place with room for the ones he still can't recall, and a journal of everything he writes down. Tell me what to change.";
const PROMPT = "An app that helps Balan find his mother: the places they lived, the names she used, and every memory he has as a clue";

const previewFrame = (page) => page.wc.mainFrame.framesInSubtree.find((f) => f !== page.wc.mainFrame && f.url.startsWith("about:srcdoc"));

// A bottom-bar button in the rendered app, by its label: where it is on screen, and the frame.
async function tabButton(page, label) {
    for (let i = 0; i < 60; i++) {
        const f = previewFrame(page);
        const r = f && (await f.executeJavaScript(`(() => { const b = [...document.querySelectorAll(".tabsbar button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null; })()`).catch(() => null));
        const host = await page.layoutRect('iframe[title="App preview"]');
        if (r && host) return { f, cx: host.x + r.cx, cy: host.y + r.cy };
        await page.wait(100);
    }
    throw new Error(`${label} not found in the preview`);
}

module.exports = async function makeScene(page) {
    await openNew(page, "make", 'textarea[aria-label="Prompt"]');
    await page.js(`window.__nagmaDemoApp = { files: ${JSON.stringify(FILES)}, reply: ${JSON.stringify(REPLY)} }; true`);
    const box = await page.rect('textarea[aria-label="Prompt"]');
    await page.move(box.cx + 260, box.cy - 160, 1);
    page.start();
    await page.wait(150);
    // In on the composer while the prompt is typed and sent.
    await Promise.all([page.zoom(box.cx, box.cy, 1.6, 700), page.move(box.x + 120, box.y + 30, 700)]);
    await page.click(undefined, undefined, { pause: 60 });
    await page.type(PROMPT, 30);
    await page.wait(250);
    await page.key("Enter");
    await page.unzoom(600);
    // The chat: Thinking, Planning the layout, Writing index.html, src/main.tsx…
    await page.zoom(190, 300, 1.55, 800, { wait: false });
    await page.move(260, 380, 800);
    await page.waitFor("text=5 files changed", 15000);
    await page.mark("built");
    // Out as the app renders, then Places → the memory map.
    const s = await tabButton(page, "Places");
    await Promise.all([page.unzoom(700), page.move(s.cx - 50, s.cy - 120, 700)]);
    await page.wait(900);
    await page.move(s.cx, s.cy, 450);
    await page.wait(80);
    await page.click(undefined, undefined, { pause: 30 });
    await s.f.executeJavaScript(`[...document.querySelectorAll(".tabsbar button")].find((b) => b.textContent.trim() === "Places").click()`);
    await page.mark("places");
    await page.wait(200);
    await page.move(s.cx + 60, s.cy - 260, 500);
    await page.wait(350);
};
module.exports.opts = { duration: 14, posterMark: "places", posterDelay: 0.9 };

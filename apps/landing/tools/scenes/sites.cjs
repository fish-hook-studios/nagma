// Sites: ?new=site, a blank site that becomes the "Minnal Murali" fan page. Setup (not recorded):
// the page's sections inserted through the editor's own block inserter (auto layout frames with
// web tags, links and tablet/mobile overrides, like the Insert panel's blocks): a navy nav with a
// live-text MINNAL ⚡ MURALI lockup, a hero over the film's artwork, the origin story on yellow, the
// two character cards on cream, three powers on navy, the world section with the village panorama
// and a two-up gallery, a red closing call to action over artwork and a footer. Anton for the
// headings, Barlow Condensed for labels and buttons, Barlow for copy; the eight paintings and the
// icons from the handoff (assets/mm-*.webp, icons inline as SVG fills). Recorded: zoomed in on the
// hero, the headline is double-clicked and finished "LOCAL HERO. HIGH VOLTAGE."; the origin section
// is selected and its fill set to the electric yellow in the Fill panel (every breakpoint follows);
// then Preview, zoomed in on the width handle, dragged narrower so the page reflows to its tablet
// and mobile layouts; then the Publish panel.
const { frameView, nodeRect, openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

const ART = ["hero", "tailor", "jaison", "shibu", "village", "storm", "action", "closing"];
const IMAGES = Object.fromEntries(ART.map((k) => [k, "data:image/webp;base64," + fs.readFileSync(path.join(__dirname, "assets", `mm-${k}.webp`)).toString("base64")]));
const ICON = {
    lightning: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#F6CC36"><path d="M59 4 19 57h27l-9 39 45-59H54z"/></svg>',
    strength: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#F6CC36"><path d="M29 91 25 63 15 48q-5-10 4-13 6-2 13 9V21q0-11 10-10 6 0 6 9V9q0-8 9-6 6 1 6 9v11q1-10 9-8 7 1 7 10v7q3-7 9-3 5 2 4 12l-5 24-9 26z"/><path d="m34 48 26 10M48 24v20M63 25v20M78 35v13" fill="none" stroke="#082438" stroke-width="4"/></svg>',
    palm: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#F6CC36"><path d="M44 93q11-30 8-57h7q6 29 2 57zM54 34Q22 6 5 36q25-11 43 4Q14 33 11 62q22-22 39-18Q35 65 40 76q16-19 18-34Q79 55 88 72q9-28-24-37Q86 29 98 41q-8-29-39-14Q63 7 82 7 57-6 54 25 40 6 28 10q17 9 26 24z"/></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#F3EBD8"><circle cx="50" cy="50" r="43" fill="none" stroke="#F3EBD8" stroke-width="5"/><path d="m40 29 31 21-31 21z"/></svg>',
    arrow: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M16 50h65M58 25l25 25-25 25" fill="none" stroke="#082438" stroke-width="7"/></svg>',
};
for (const k of Object.keys(ICON)) IMAGES["icon-" + k] = "data:image/svg+xml;base64," + Buffer.from(ICON[k]).toString("base64");

const SETUP = `(async () => {
  const IMAGES = ${JSON.stringify(IMAGES)};
  const [{ solid, imagePaint }, { storeDataUrl }, B, F, files] = await Promise.all([import("/src/engine/paint.ts"), import("/src/engine/image-store.ts"), import("/src/site/blocks.ts"), import("/src/engine/fonts.ts"), import("/src/engine/files.ts")]);
  const load = (f) => new Promise((r) => { const t = setTimeout(r, 6000); F.ensureFont(f, () => { clearTimeout(t); r(); }); });
  await Promise.all(["Anton", "Barlow Condensed", "Barlow"].map(load));
  // The pictures, stored as media and added to the file.
  const refs = {};
  for (const k of Object.keys(IMAGES)) refs[k] = await storeDataUrl(IMAGES[k]);
  nagma.execute({ type: "batch", commands: Object.keys(refs).map((k) => ({ type: "image.add", id: "mm-" + k, data: refs[k] })) });
  const pageId = nagma.get().pageId;
  const NAVY = "#082438", YELLOW = "#F6CC36", RED = "#D92128", CREAM = "#F3EBD8";
  // The same spec shapes the Insert panel's blocks use.
  const stack = (direction, gap, padding = [0, 0, 0, 0], primary = "start", counter = "start", wrap = false) => ({ direction, gap, padding, primary, counter, ...(wrap ? { wrap: true, counterGap: gap } : {}) });
  const frame = (name, layout, props = {}, children = [], extra = {}) => ({ type: "frame", name, props: { fills: [], clip: false, layout, sizing: { h: "fill", v: "hug" }, ...props }, children, ...extra });
  const text = (value, o, extra = {}) => ({ type: "text", name: value.length > 28 ? value.slice(0, 28) + "…" : value, props: { text: value, fontSize: o.size, fontWeight: o.weight || 400, fontFamily: o.font || "Barlow", lineHeight: o.lh ?? (o.size >= 32 ? 1.15 : 1.55), letterSpacing: o.ls ?? 0, fills: [solid(o.color)], sizing: o.sizing || { h: "fill", v: "hug" }, ...(o.align ? { textAlign: o.align } : {}), ...(o.maxW ? { maxW: o.maxW } : {}) }, ...extra });
  const display = (value, size, color, extra = {}, mobile = {}) => text(value, { font: "Anton", size, color, lh: 0.95, ls: Math.round(-0.02 * size) }, { ...extra, mobile: { fontSize: Math.round(size * 0.5), letterSpacing: Math.round(-0.01 * size), ...mobile } });
  const label = (value, color, size = 15) => text(value, { font: "Barlow Condensed", size, weight: 700, color, ls: Math.round(size * 0.08), lh: 1.2, sizing: { h: "hug", v: "hug" } });
  const body = (value, color, size = 18, maxW = 520) => text(value, { size, weight: 500, color, lh: 1.55, maxW }, { web: { tag: "p" }, mobile: { fontSize: 16 } });
  const pic = (name, key, h, props = {}, extra = {}) => ({ type: "rect", name, props: { fills: [imagePaint("mm-" + key, "fill")], radius: 0, w: 400, h, sizing: { h: "fill", v: "fixed" }, altText: name, ...props }, ...extra });
  const icon = (key, size = 56) => ({ type: "rect", name: "Icon: " + key, props: { fills: [imagePaint("mm-icon-" + key, "fit")], w: size, h: size, sizing: { h: "fixed", v: "fixed" }, altText: "" } });
  const button = (value, bg, fg, url, o = {}) => frame("Button: " + value, stack("horizontal", 12, [16, 28, 16, 28], "center", "center"), { fills: [solid(bg)], radius: 2, sizing: { h: "hug", v: "hug" }, ...(o.stroke ? { strokes: [solid(o.stroke)], strokeWidth: 3 } : {}) }, [...(o.icon ? [icon(o.icon, 22)] : []), label(value, fg, 18)], { web: { link: { kind: "url", url }, hover: { fill: o.hoverFill || bg, y: -2, duration: 150 } } });
  const section = (name, bg, children, o = {}) => frame(name, stack("vertical", 0, [o.pad ?? 96, 48, o.pad ?? 96, 48], "start", "center"), { fills: o.image ? [imagePaint("mm-" + o.image, "fill")] : bg ? [solid(bg)] : [], ...(o.minH ? { minH: o.minH } : {}) }, [frame("Container", stack("vertical", o.gap ?? 40, [0, 0, 0, 0], "start", o.align || "start"), { maxW: 1120 }, children, { mobile: { layout: stack("vertical", Math.round((o.gap ?? 40) * 0.7), [0, 0, 0, 0], "start", o.align || "start") } })], { web: { tag: o.tag || "section", ...(o.anchor ? { anchor: o.anchor } : {}) }, mobile: { layout: stack("vertical", 0, [Math.round((o.pad ?? 96) * 0.6), 20, Math.round((o.pad ?? 96) * 0.6), 20], "start", "center"), ...(o.image ? { fills: [solid(bg)] } : {}) } });
  const wordmark = (size, color) => frame("Wordmark", stack("horizontal", Math.round(size * 0.18), [0, 0, 0, 0], "start", "center"), { sizing: { h: "hug", v: "hug" } }, [
    text("MINNAL", { font: "Anton", size, color, lh: 1, ls: -1, sizing: { h: "hug", v: "hug" } }),
    icon("lightning", Math.round(size * 0.9)),
    text("MURALI", { font: "Anton", size, color, lh: 1, ls: -1, sizing: { h: "hug", v: "hug" } }),
  ], { web: { link: { kind: "url", url: "#top" } } });
  const NETFLIX = "https://www.netflix.com/title/81497215";
  const specs = [
    // Nav.
    frame("Navigation", stack("horizontal", 32, [18, 48, 18, 48], "between", "center"), { fills: [solid(NAVY)] }, [
      wordmark(26, YELLOW),
      frame("Links", stack("horizontal", 28, [0, 0, 0, 0], "start", "center"), { sizing: { h: "hug", v: "hug" } }, [["STORY", "#story"], ["CHARACTERS", "#characters"], ["THE WORLD", "#world"]].map(([t, u]) => ({ ...label(t, CREAM, 15), web: { link: { kind: "url", url: u } } })), { mobile: { visible: false } }),
      button("WATCH TRAILER", YELLOW, NAVY, "#trailer"),
    ], { web: { tag: "nav", anchor: "top" }, mobile: { layout: stack("horizontal", 16, [14, 20, 14, 20], "between", "center") } }),
    // Hero: copy in the artwork's empty left; on mobile the picture sits above a navy panel.
    section("Hero", NAVY, [
      pic("Hero artwork", "hero", 420, { visible: false }, { mobile: { visible: true, h: 200 } }),
      frame("Copy", stack("vertical", 22, [0, 0, 0, 0]), { maxW: 560 }, [
        label("A BASIL JOSEPH FILM", YELLOW, 15),
        display("LOCAL HERO.", 112, YELLOW, { web: { tag: "h1" } }),
        body("An ordinary tailor. An extraordinary strike.", CREAM, 20),
        frame("Buttons", stack("horizontal", 16, [8, 0, 0, 0], "start", "center", true), { sizing: { h: "hug", v: "hug" } }, [button("WATCH TRAILER", RED, CREAM, "#trailer", { icon: "play", hoverFill: "#B81B21" })]),
        frame("Lockup", stack("vertical", 0, [24, 0, 0, 0]), { sizing: { h: "hug", v: "hug" } }, [wordmark(54, YELLOW)]),
      ]),
    ], { image: "hero", pad: 120, minH: 760, gap: 0, anchor: "trailer" }),
    // Origin.
    section("Origin", CREAM, [
      label("01 / THE ORIGIN", NAVY, 14),
      frame("Split", stack("horizontal", 64, [0, 0, 0, 0], "start", "center"), {}, [
        frame("Story", stack("vertical", 24), {}, [
          display("EVERY TOWN NEEDS A HERO.", 84, NAVY, { web: { tag: "h2" } }),
          body("In Kurukkanmoola, a bolt of lightning changes a tailor's life forever. Meet Jaison. Your not-so-ordinary neighbourhood hero.", NAVY, 18, 480),
        ]),
        pic("Jaison at his sewing machine", "tailor", 400, { strokes: [solid(NAVY)], strokeWidth: 4 }),
      ], { tablet: { layout: stack("vertical", 40) }, mobile: { layout: stack("vertical", 28) } }),
    ], { anchor: "story", gap: 28 }),
    // Characters.
    section("Characters", CREAM, [
      display("ONE STORM. TWO DESTINIES.", 92, NAVY, { web: { tag: "h2" }, props: {} }),
      frame("Cards", stack("horizontal", 40, [0, 0, 0, 0], "start", "start"), {}, [
        ["Jaison", "THE UNLIKELY HERO", "jaison"],
        ["Shibu", "THE OTHER SIDE OF THE STORM", "shibu"],
      ].map(([n, role, key]) => frame("Card: " + n, stack("vertical", 16), {}, [
        pic(n, key, 560, { strokes: [solid(NAVY)], strokeWidth: 4 }),
        frame("Name", stack("vertical", 4), {}, [
          text(n.toUpperCase(), { font: "Barlow Condensed", size: 30, weight: 700, color: RED, ls: 1, lh: 1.1 }, { web: { tag: "h3" } }),
          label(role, NAVY, 14),
        ]),
      ])), { mobile: { layout: stack("vertical", 32) } }),
    ], { anchor: "characters", gap: 48 }),
    // Powers.
    section("Powers", NAVY, [
      frame("Three", stack("horizontal", 48, [0, 0, 0, 0], "start", "start"), {}, [
        ["strength", "SUPER STRENGTH", "More than just muscle."],
        ["lightning", "LIGHTNING SPEED", "Faster than you see."],
        ["palm", "VERY LOCAL ROOTS", "A hero who stays home."],
      ].map(([key, t, b]) => frame("Power: " + t, stack("horizontal", 20, [0, 0, 0, 0], "start", "center"), {}, [
        icon(key, 64),
        frame("Text", stack("vertical", 6), {}, [text(t, { font: "Barlow Condensed", size: 26, weight: 700, color: YELLOW, ls: 1, lh: 1.05 }, { web: { tag: "h3" } }), body(b, CREAM, 16, 260)]),
      ])), { mobile: { layout: stack("vertical", 28) } }),
    ], { pad: 56, gap: 0 }),
    // The world.
    section("World", CREAM, [
      label("03 / THE WORLD", NAVY, 14),
      display("WELCOME TO KURUKKANMOOLA.", 96, NAVY, { web: { tag: "h2" } }),
      body("Small-town charm. Superhero-sized trouble.", NAVY, 20),
      pic("Kurukkanmoola at dusk", "village", 600, { strokes: [solid(NAVY)], strokeWidth: 4 }, { mobile: { h: 240 } }),
      frame("Gallery", stack("horizontal", 32, [0, 0, 0, 0]), {}, [
        pic("The storm over the paddy fields", "storm", 320, { strokes: [solid(NAVY)], strokeWidth: 4 }, { mobile: { h: 200 } }),
        pic("Minnal Murali on the rooftops", "action", 320, { strokes: [solid(NAVY)], strokeWidth: 4 }, { mobile: { h: 200 } }),
      ], { mobile: { layout: stack("vertical", 20) } }),
    ], { anchor: "world", gap: 24 }),
    // Closing: copy at left over the red artwork; on mobile, the picture over a red panel.
    section("Closing", RED, [
      pic("Minnal Murali, back to us", "closing", 360, { visible: false }, { mobile: { visible: true, h: 200 } }),
      frame("Copy", stack("vertical", 28), { maxW: 620 }, [
        display("THE STORM IS JUST BEGINNING.", 96, YELLOW, { web: { tag: "h2" } }),
        frame("Buttons", stack("horizontal", 16, [4, 0, 0, 0], "start", "center", true), { sizing: { h: "hug", v: "hug" } }, [button("WATCH ON NETFLIX", YELLOW, NAVY, NETFLIX, { icon: "arrow", hoverFill: "#FFD84A" })]),
      ]),
    ], { image: "closing", pad: 120, minH: 620, gap: 0 }),
    // Footer.
    section("Footer", NAVY, [
      wordmark(36, YELLOW),
      label("2021 · MALAYALAM · ACTION / COMEDY", CREAM, 14),
      text("Fan-made concept. Not affiliated with the film's makers.", { size: 14, weight: 500, color: "#9FB0BF", lh: 1.5, sizing: { h: "hug", v: "hug" } }),
    ], { tag: "footer", pad: 56, gap: 14, align: "center" }),
  ];
  for (const spec of specs) B.insertSpec(spec, pageId);
  nagma.refreshText && nagma.refreshText();
  nagma.set({ selection: [] });
  try { nagma.execute({ type: "doc.rename", name: "Minnal Murali" }); files.renameFile(nagma.get().fileId, "Minnal Murali"); } catch (e) {}
  const N = nagma.get().doc.nodes;
  const page = N[pageId];
  const kids = page.children.map((id) => N[id]);
  const desktop = kids.find((n) => n.name === "Desktop"), tablet = kids.find((n) => n.name === "Tablet");
  const under = (root, test) => { let hit = null; const walk = (id) => { const n = N[id]; if (!n || hit) return; if (test(n)) { hit = n; return; } (n.children || []).forEach(walk); }; walk(root.id); return hit; };
  const hero = under(desktop, (n) => n.name === "Hero"), origin = under(desktop, (n) => n.name === "Origin");
  const h1 = under(hero, (n) => n.type === "text" && n.text === "LOCAL HERO.");
  return { hero: hero.id, origin: origin.id, h1: h1.id, desktop: { x: desktop.x, y: desktop.y, w: desktop.w }, tablet: { x: tablet.x, w: tablet.w } };
})()`;

// The first Hex colour field in the right panel, scrolled into view, clicked and selected.
async function hex(page) {
    await page.js(`(() => { document.querySelectorAll("[data-rec-hex]").forEach((e) => e.removeAttribute("data-rec-hex")); const i = [...document.querySelectorAll("input")].find((b) => (b.getAttribute("aria-label") || b.closest("label")?.title || "") === "Hex colour"); if (!i) return false; i.setAttribute("data-rec-hex", "1"); const r = i.getBoundingClientRect(); if (r.top < 120 || r.bottom > innerHeight - 60) { let sc = i.parentElement; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (sc) sc.scrollTo({ top: sc.scrollTop + r.top - innerHeight * 0.45, behavior: "smooth" }); } return true; })()`);
    await page.wait(450);
    const f = await page.waitFor("[data-rec-hex]");
    await page.click(f.cx, f.cy, { ms: 420, pause: 40 });
    await page.js(`(() => { const i = document.querySelector("[data-rec-hex]"); i.focus(); i.select(); })()`);
    return f;
}

module.exports = async function sitesScene(page) {
    await openNew(page, "site", "text=Use a template");
    await page.wait(400);
    const ids = await page.js(SETUP);
    await page.wait(600);
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
    // The desktop hero and origin, the tablet frame beside them.
    await frameView(page, { x: 0, y: 0, w: ids.tablet.x + 420, h: 900, margin: 24, offsetY: -10 });
    await page.wait(1600);
    const h1 = await nodeRect(page, ids.h1);
    const origin = await nodeRect(page, ids.origin);
    await page.move(origin.right - 60, origin.y + 40, 1);
    page.start();
    await page.wait(250);
    // In on the hero: the headline finished.
    await Promise.all([page.zoom(h1.cx + 60, h1.cy + 30, 1.5, 750), page.move(h1.x + 50, h1.y + 22, 750)]);
    // Canvas hit-testing measures from the canvas's corner, so the pointer is anchored to it.
    await page.anchor('[data-region="canvas"]');
    await page.click(h1.x + 50, h1.y + 22, { ms: 120, count: 2, pause: 40 });
    await page.wait(120);
    // Under the zoom the double-click can land a section off; the edit then starts on the headline itself.
    if (!(await page.js("!!nagma.get().editingTextId"))) await page.js(`nagma.set({ selection: [${JSON.stringify(ids.h1)}], editingTextId: ${JSON.stringify(ids.h1)}, tool: "move" })`);
    await page.wait(150);
    if (!(await page.js("!!nagma.get().editingTextId"))) throw new Error("headline not in text edit");
    await page.wait(150);
    await page.key("End", ["meta"]);
    await page.type(" HIGH VOLTAGE.", 55);
    await page.wait(250);
    await page.key("Escape");
    await page.mark("headline");
    await page.wait(200);
    // The origin section (its top padding) and the electric yellow.
    await page.anchor(null);
    await Promise.all([page.unzoom(800), page.move(origin.x + 40, origin.y + 12, 800)]);
    await page.click(undefined, undefined, { pause: 80 });
    await page.wait(350);
    const picked = await page.js("nagma.get().selection.map((id) => nagma.get().doc.nodes[id].name).join()");
    if (picked !== "Origin") throw new Error("origin not selected: " + picked);
    await hex(page);
    await page.type("F6CC36", 55);
    await page.key("Enter");
    await page.mark("yellow");
    await page.wait(400);
    await page.clickEl("label=Preview", { ms: 650, pause: 60 });
    await page.waitFor("label=Close preview");
    // Until the built page has painted in the preview frame (it starts blank).
    // The frame is sandboxed, so it is read through the window's own frame list.
    const painted = async () => {
        for (const f of page.wc.mainFrame.framesInSubtree) {
            if (f === page.wc.mainFrame || !f.url.startsWith("about:srcdoc")) continue;
            const n = await f.executeJavaScript(`(document.body && document.body.innerText || "").length`).catch(() => 0);
            if (n > 40) return true;
        }
        return false;
    };
    for (let i = 0; i < 60 && !(await painted()); i++) await page.wait(100);
    await page.wait(250);
    // The preview's right-hand width handle (the right panel has ew-resize scrubbers too).
    const handle = async () => (await page.all(".cursor-ew-resize")).filter((r) => r.h > 200 && r.cx > 700 && r.cx < 1100).pop() || { cx: 1026, cy: 440 };
    let h = await handle();
    // In on the right half of the preview and its handle; the drag keeps the pointer on the handle.
    await Promise.all([page.zoom(690, 420, 1.5, 800), page.move(h.cx, h.cy, 800)]);
    await page.anchor({ x: h.cx, y: h.cy });
    await page.drag(h.cx, h.cy, h.cx - 120, h.cy, 750, undefined, 100);
    await page.wait(300);
    h = await handle();
    await page.anchor({ x: h.cx, y: h.cy });
    await page.drag(h.cx, h.cy, 860, h.cy, 700, undefined, 120);
    await page.mark("narrow");
    await page.wait(400);
    await page.anchor(null);
    // Back out, and Publish… (beside the preview) opens the Publish panel; the loop rests there.
    const pub = await page.rect("text=Publish…");
    await Promise.all([page.unzoom(800), page.move(pub.cx, pub.cy, 800)]);
    await page.click(undefined, undefined, { pause: 80 });
    await page.waitFor("text=Publish site");
    await page.wait(300);
    await page.move(560, 330, 600);
    await page.wait(350);
};
// Big paintings and zooms: the MP4 needs crf 36 to stay near 600 KB.
module.exports.opts = { duration: 14, posterMark: "yellow", posterDelay: 0.4, crf: 36 };
module.exports.SETUP = SETUP;

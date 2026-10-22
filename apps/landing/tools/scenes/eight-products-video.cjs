// Video: "Eight products. One file browser." (apps/landing/products.html) rebuilt as an editable
// Nagma video project, so the words, timing and colours can be changed in the app. The page's
// 3D ring becomes its flat equivalent: the front card centred and full size, its neighbours at
// the sides smaller and dimmer, and on every turn the three slide one slot to the left (the next
// card in from the right, the old one out to the left) on an ease with a slight overshoot.
//
// Built in the page through the editor's own modules, the way the other scenes do:
//   cd apps/desktop && npx electron ../landing/tools/record.cjs --serve 5319
//   node apps/landing/tools/cap.mjs 'delete require.cache[require.resolve("/abs/.../eight-products-video.cjs")]; return await require("/abs/.../eight-products-video.cjs")(page, { out: "/abs/dir" })'
// It writes apps/landing/eight-products.nagma.json (File › Save local copy's format, the eight
// loops embedded, so Import… opens it anywhere) and, when `out` is given, exact 1280×720 renders
// of a few frames and screenshots of the editor there.
//
// Timing is the page's render plan: a 1.8 s intro (the heading rises, the highlight wipes in),
// then card i at the front from 1.8 + 7 i for 6 s, with a 1 s turn between cards. 3840×2160 at
// 30 fps; every size below is in those pixels (the page laid out at 1920×1080, doubled).
const { openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

const IMG = path.resolve(__dirname, "../../img");
const OUT_FILE = path.resolve(__dirname, "../../eight-products.nagma.json");

const PRODUCTS = [
    { n: "01", name: "Design", bg: "#EF7F42", text: "Vectors, auto layout, components, prototypes, motion, inspect. Opens .fig and .sketch.", loop: "design" },
    { n: "02", name: "Board", bg: "#F5C842", text: "Stickies, sections, connectors, templates, voting and a timer. Turn clusters into frames.", loop: "board" },
    { n: "03", name: "Slides", bg: "#8FC1F0", text: "Templates, a real design canvas on every slide, presenter notes, export to PDF and PowerPoint.", loop: "slides" },
    { n: "04", name: "Campaign", bg: "#FC829A", text: "Posts, stories and banners in every size from one design, with brand kits and bulk edits.", loop: "campaign" },
    { n: "05", name: "Sites", bg: "#BFE6C8", text: "Responsive sites with breakpoints, a CMS and one-click publishing to your own server and domain.", loop: "sites" },
    { n: "06", name: "Make", bg: "#C9B8F2", text: "Apps from a prompt or from your frames, with your own AI key from any provider.", loop: "make" },
    { n: "07", name: "Video", bg: "#F6F1E7", text: "Clips, titles and motion graphics, exported to MP4 inside the app.", loop: "video" },
    { n: "08", name: "Document", bg: "#BFE6C8", text: "Open any PDF, reorder pages, edit the text, fill forms and sign.", loop: "document" },
];

// The page's clock.
const PLAN = { intro: 1.8, per: 6, turn: 1, tail: 1.2 };

// The page's own copy of an engine module: after an edit while the dev server runs, Vite serves
// the changed module and its importers under ?t=<stamp>, and a bare import would make a second
// copy whose stores the app never reads. The address the app loaded is found among the page's
// resource entries.
const LIVE = `const live = (p) => { const hit = performance.getEntriesByType("resource").map((r) => new URL(r.name)).find((u) => u.pathname === p); return hit ? hit.pathname + hit.search : p; };`;

// Runs in the page: imports the loops, then builds the whole composition and saves it as the
// open file. Returns the clip ids by name.
const BUILD = (videos) => `(async () => {
  ${LIVE}
  const PRODUCTS = ${JSON.stringify(PRODUCTS)};
  const PLAN = ${JSON.stringify(PLAN)};
  const VIDEOS = ${JSON.stringify(videos)};
  const [A, M, S, files] = await Promise.all([import(live("/src/engine/video/actions.ts")), import(live("/src/engine/video/model.ts")), import(live("/src/engine/video/state.ts")), import(live("/src/engine/files.ts"))]);

  // ---- The loops into the media bin (FilmCraft reads each file's facts and poster) ----
  const toFile = (v) => { const bin = atob(v.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new File([bytes], v.name, { type: "video/mp4" }); };
  const inBin = () => S.currentProject().media.filter((m) => PRODUCTS.some((p) => m.name === "loop-" + p.loop + ".mp4")).length;
  if (VIDEOS.length && inBin() < PRODUCTS.length) {
    await A.importFiles(VIDEOS.map(toFile));
    for (let i = 0; i < 100 && inBin() < PRODUCTS.length; i++) await new Promise((r) => setTimeout(r, 100));
  }
  let project = S.currentProject();
  const mediaOf = (loop) => project.media.find((m) => m.name === "loop-" + loop + ".mp4");
  const missing = PRODUCTS.filter((p) => !mediaOf(p.loop)).map((p) => "loop-" + p.loop + ".mp4");
  if (missing.length) throw new Error("Import these loops first (Import media, from apps/landing/img): " + missing.join(", "));

  // ---- Sizes (3840×2160) ----
  const W = 3840, H = 2160, CX = W / 2, CY = H / 2;
  const INK = "#141413", CREAM = "#F6F1E7", GREEN = "#4FAF78";
  const DISPLAY = "Coconat", BODY = "Absans";
  const N = PRODUCTS.length;
  const land = (i) => PLAN.intro + i * (PLAN.per + PLAN.turn);
  const TOTAL = land(N - 1) + PLAN.per + PLAN.tail;
  const CARD = { w: 1426, h: 1267, y: 1381, radius: 72, pad: 64, stroke: 5, shadow: 20 };
  // Where a card sits by its slot on the flattened ring: front, left, right, and off either side.
  const SLOT = { x: { "-1": 690, 0: 1920, 1: 3150 }, offLeft: -800, offRight: 4640, scale: 66, dim: 85 };
  const posOf = (slot) => (slot <= -2 ? SLOT.offLeft : slot >= 2 ? SLOT.offRight : SLOT.x[String(slot)]);
  const scaleOf = (slot) => (slot === 0 ? 100 : SLOT.scale);
  const alphaOf = (slot) => (slot === 0 ? 100 : SLOT.dim);
  // The page's turn: an ease out with a slight overshoot.
  const TURN_BEZ = [0.34, 1.3, 0.64, 1];
  const SITE_BEZ = [0.2, 0.8, 0.2, 1];
  const key = (t, v, ease = "bezier", bezier = SITE_BEZ) => ({ t: Math.round(t * 1000) / 1000, v, ease, ...(ease === "bezier" ? { bezier } : {}) });
  const id = () => Math.random().toString(36).slice(2, 10);

  // Text measured the way the title renderer draws it (canvas, letter spacing included).
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (text, font, size, tracking) => { ctx.font = "400 " + size + 'px "' + font + '", Inter, system-ui, sans-serif'; ctx.letterSpacing = tracking + "px"; return Math.max(...text.split("\\n").map((l) => ctx.measureText(l).width)); };
  const wrap = (text, font, size, tracking, max) => { const words = text.split(" "); const lines = []; let line = ""; for (const w of words) { const next = line ? line + " " + w : w; if (line && measure(next, font, size, tracking) > max) { lines.push(line); line = w; } else line = next; } if (line) lines.push(line); return lines.join("\\n"); };
  const title = (text, font, size, color, extra = {}) => ({ text, font, weight: 400, size, color, align: "left", tracking: 0, lineHeight: 1, stroke: null, shadow: null, box: null, animIn: "none", animOut: "none", animDur: 0.6, ...extra });
  const rect = (name, fill, stroke) => ({ id: id(), kind: "rect", name, fill, stroke, cap: "round", join: "round", dash: [] });
  const rectProps = (item, o) => { const out = {}; for (const [k, v] of Object.entries(o)) out["shape." + item.id + "." + k] = v; return out; };

  // ---- Tracks: top first (drawn last) ----
  const comp0 = M.compById(project, "root");
  const track = (name) => ({ id: id(), kind: "video", name });
  const LANES = ["A", "B", "C", "D"];
  const lanes = (name) => LANES.map((l) => track(name + " " + l));
  const T = { heading1: track("Heading 1"), heading2: track("Heading 2"), highlight: track("Highlight"), descriptions: lanes("Descriptions"), titles: lanes("Titles"), numbers: lanes("Numbers"), loops: lanes("Loops"), cards: lanes("Cards"), background: track("Background") };
  const tracks = [T.heading1, T.heading2, T.highlight, ...T.descriptions, ...T.titles, ...T.numbers, ...T.loops, ...T.cards, T.background, ...comp0.tracks.filter((t) => t.kind === "audio")];
  const clips = [];
  const ids = {};
  const add = (kind, track, start, duration, name, extra) => { const c = M.newClip(kind, track.id, start, duration, name, extra); clips.push(c); ids[name] = c.id; return c; };

  // ---- Background and heading ----
  add("solid", T.background, 0, TOTAL, "Background", { color: INK });
  const HEAD = { size: 180, tracking: -3.6, lineHeight: 0.94 };
  const headTitle = (text) => title(text, DISPLAY, HEAD.size, CREAM, { align: "center", tracking: HEAD.tracking, lineHeight: HEAD.lineHeight, animIn: "rise", animDur: 0.9 });
  add("title", T.heading1, 0, TOTAL, "Heading: Eight products.", { title: headTitle("Eight products."), props: { x: CX, y: 240 } });
  add("title", T.heading2, 0, TOTAL, "Heading: One file browser.", { title: headTitle("One file browser."), props: { x: CX, y: 450 } });
  // The green highlight under the second line wipes in from the left (its width grows while its
  // centre follows, so the left edge stays put).
  const hl = rect("Highlight", GREEN, null);
  const HL = { left: 1125, w: 1605, h: 189, cy: 455 };
  add("shape", T.highlight, 0, TOTAL, "Highlight", {
    shapes: [hl],
    props: rectProps(hl, { y: HL.cy - CY, h: HL.h, radius: 24, rotation: -1, opacity: 90 }),
    anim: { ["shape." + hl.id + ".w"]: [key(0.5, 0), key(1.1, HL.w)], ["shape." + hl.id + ".x"]: [key(0.5, HL.left - CX), key(1.1, HL.left + HL.w / 2 - CX)] },
  });

  // ---- The cards ----
  // Card i's slot on the ring while card c is at the front: 0 front, -1 left, 1 right, else away.
  const slotOf = (i, c) => ((((i - c + 4) % N) + N) % N) - 4;
  // The keys of one property over the whole piece: parked at each landing (hold), moving through
  // each turn. Cut to the clip's own span, as times from its start.
  const ringKeys = (i, start, end, valueOf) => {
    const all = [key(0, valueOf(slotOf(i, 0)), "hold")];
    for (let c = 1; c < N; c++) all.push(key(land(c) - PLAN.turn, valueOf(slotOf(i, c - 1)), "bezier", TURN_BEZ), key(land(c), valueOf(slotOf(i, c)), "hold"));
    return all.filter((k) => k.t >= start - 1e-6 && k.t <= end + 1e-6).map((k) => ({ ...k, t: Math.round((k.t - start) * 1000) / 1000 }));
  };
  // Card i is on screen from the turn that brings it in on the right to the end of the turn that
  // takes it off on the left. Design is also the last card's right neighbour, and Document the
  // first card's left one, so those two get a second set of clips for that appearance.
  const spanOf = (i) => ({ start: i <= 0 ? 0 : land(i - 1) - PLAN.turn, end: i + 2 >= N ? TOTAL : land(i + 2) });
  const NUM = { size: 240, lineHeight: 0.8, tracking: -12, top: 32, right: 48, opacity: 25 };
  const TTL = { size: 144, lineHeight: 1 };
  const DESC = { size: 34, lineHeight: 1.5, max: 840 };
  const LOOP = { w: CARD.w - CARD.pad * 2, h: CARD.h - CARD.pad * 2 - TTL.size - 32 - 32 - DESC.size * DESC.lineHeight * 2, radius: 40 };
  LOOP.top = -CARD.h / 2 + CARD.pad + TTL.size + 32;
  LOOP.cy = LOOP.top + LOOP.h / 2;
  const card = (i, tag) => {
    const p = PRODUCTS[((i % N) + N) % N];
    const media = mediaOf(p.loop);
    const lane = ((i % 4) + 4) % 4;
    const { start, end } = spanOf(i);
    const dur = end - start;
    const suffix = tag ? " (" + tag + ")" : "";
    const label = "Card " + p.n + " " + p.name + suffix;
    // The card: its hard shadow, the coloured card with the ink border, and the white loop
    // window with its border (the loop covers the inner half of that stroke).
    const shadow = rect("Shadow", INK, null);
    const face = rect("Card", p.bg, INK);
    const win = rect("Window", "#FFFFFF", INK);
    const body = add("shape", T.cards[lane], start, dur, label, {
      shapes: [shadow, face, win],
      props: { x: posOf(slotOf(i, 0)), y: CARD.y, ...rectProps(shadow, { x: CARD.shadow, y: CARD.shadow, w: CARD.w, h: CARD.h, radius: CARD.radius }), ...rectProps(face, { w: CARD.w, h: CARD.h, radius: CARD.radius, strokeWidth: CARD.stroke }), ...rectProps(win, { y: LOOP.cy, w: LOOP.w, h: LOOP.h, radius: LOOP.radius, strokeWidth: CARD.stroke * 2 }) },
      anim: { x: ringKeys(i, start, end, posOf), scaleX: ringKeys(i, start, end, scaleOf), scaleY: ringKeys(i, start, end, scaleOf), opacity: ringKeys(i, start, end, alphaOf) },
    });
    const dim = (k = 1) => ({ opacity: ringKeys(i, start, end, (s) => alphaOf(s) * k) });
    const child = (dx, dy) => ({ parent: body.id, props: { x: CX + dx, y: CY + dy } });
    // The loop: the 1440×900 file sits in the frame at 3456×2160, scaled to cover the window
    // (object-fit cover, top aligned), its corners rounded by a path mask, and its time remapped
    // so it rests on its first frame until the card lands, plays while the card is at the front,
    // then holds its last frame.
    const fitW = Math.round((media.width * Math.min(W / media.width, H / media.height)) * 1000) / 1000, fitH = Math.round((media.height * Math.min(W / media.width, H / media.height)) * 1000) / 1000;
    const cover = Math.max(LOOP.w / fitW, LOOP.h / fitH);
    const shownW = fitW * cover, shownH = fitH * cover;
    const inset = (shownW - LOOP.w) / 2 / shownW, insetY = (shownH - LOOP.h) / shownH;
    const rx = LOOP.radius / shownW, ry = LOOP.radius / shownH;
    const pts = [];
    const corner = (cx, cy, from) => { for (let k = 0; k <= 8; k++) { const a = from + (k / 8) * (Math.PI / 2); pts.push({ x: Math.round((cx + Math.cos(a) * rx) * 10000) / 10000, y: Math.round((cy + Math.sin(a) * ry) * 10000) / 10000 }); } };
    corner(1 - inset - rx, ry, -Math.PI / 2); corner(1 - inset - rx, 1 - insetY - ry, 0); corner(inset + rx, 1 - insetY - ry, Math.PI / 2); corner(inset + rx, ry, Math.PI);
    const mask = { id: id(), shape: "path", mode: "add", points: pts };
    const front = land(((i % N) + N) % N);
    const plays = i >= 0 && i < N;
    const timeKeys = plays ? [key(0, 0, "hold"), key(front - start, 0, "linear"), key(front - start + PLAN.per, PLAN.per, "hold")] : [key(0, 0, "hold")];
    const loopC = child(0, LOOP.top + shownH / 2);
    add("video", T.loops[lane], start, dur, "Loop: " + p.name + suffix, { media: media.id, parent: body.id, masks: [mask], props: { ...loopC.props, scaleX: Math.round(cover * 100 * 1000) / 1000, scaleY: Math.round(cover * 100 * 1000) / 1000 }, anim: { time: timeKeys, ...dim() } });
    // The ghost number, top right.
    const numW = measure(p.n, DISPLAY, NUM.size, NUM.tracking);
    add("title", T.numbers[lane], start, dur, "Number: " + p.n + suffix, { ...child(CARD.w / 2 - NUM.right - numW / 2, -CARD.h / 2 + NUM.top + (NUM.size * NUM.lineHeight) / 2), title: title(p.n, DISPLAY, NUM.size, INK, { align: "right", tracking: NUM.tracking, lineHeight: NUM.lineHeight }), anim: dim(NUM.opacity / 100) });
    // The title, top left.
    const ttlW = measure(p.name, DISPLAY, TTL.size, -TTL.size * 0.04);
    add("title", T.titles[lane], start, dur, "Title: " + p.name + suffix, { ...child(-CARD.w / 2 + CARD.pad + ttlW / 2, -CARD.h / 2 + CARD.pad + TTL.size / 2), title: title(p.name, DISPLAY, TTL.size, INK, { tracking: -TTL.size * 0.04, lineHeight: TTL.lineHeight }), anim: dim() });
    // The description, bottom left, wrapped as the page wraps it.
    const text = wrap(p.text, BODY, DESC.size, 0, DESC.max);
    const lines = text.split("\\n").length;
    const descW = measure(text, BODY, DESC.size, 0);
    add("title", T.descriptions[lane], start, dur, "Description: " + p.name + suffix, { ...child(-CARD.w / 2 + CARD.pad + descW / 2, CARD.h / 2 - CARD.pad - (DESC.size * DESC.lineHeight * lines) / 2), title: title(text, BODY, DESC.size, INK, { lineHeight: DESC.lineHeight }), anim: dim() });
  };
  card(-1, "opening");
  for (let i = 0; i < N; i++) card(i);
  card(N, "closing");

  const comp = { ...comp0, name: "Eight products", width: W, height: H, fps: 30, background: INK, tracks, clips, markers: PRODUCTS.map((p, i) => ({ id: id(), t: land(i), name: p.name, color: p.bg })) };
  S.commitComp(comp, project);
  S.vui.set({ selection: [], time: 3, compId: "root" });
  try { nagma.execute({ type: "doc.rename", name: "Eight products" }); } catch (e) {}
  try { files.renameFile(nagma.get().fileId, "Eight products"); } catch (e) {}
  return { ids, total: TOTAL, clips: clips.length, tracks: tracks.length };
})()`;

// An exact render of the composition at `t`, 1280×720, as a PNG data URL.
const RENDER = (t) => `(async () => {
  ${LIVE}
  const [R, S] = await Promise.all([import(live("/src/engine/video/render.ts")), import(live("/src/engine/video/state.ts"))]);
  const project = S.currentProject();
  const comp = S.activeComp(project);
  const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
  await R.renderComp(c.getContext("2d"), comp, ${t}, { project, doc: nagma.get().doc, scale: 1280 / comp.width, exact: true, tag: "check:" });
  return c.toDataURL("image/png").split(",")[1];
})()`;

module.exports = async function eightProductsVideo(page, { out, shots = [3, 9, 16.5, 30] } = {}) {
    await openNew(page, "video", "label=New title");
    await page.wait(300);
    const videos = PRODUCTS.map((p) => ({ name: `loop-${p.loop}.mp4`, base64: fs.readFileSync(path.join(IMG, `loop-${p.loop}.mp4`)).toString("base64") }));
    const built = await page.js(BUILD(videos));
    await page.wait(800);
    // The open file as File › Save local copy writes it: the document with the eight loops embedded.
    const json = await page.js(`(async () => { ${LIVE} const m = await import(live("/src/engine/local-copy.ts")); return m.localCopyJson(nagma.get().doc); })()`);
    fs.writeFileSync(OUT_FILE, json);
    const result = { ...built, file: OUT_FILE, bytes: json.length, frames: [] };
    if (out) {
        fs.mkdirSync(out, { recursive: true });
        for (const t of shots) {
            const png = await page.js(RENDER(t));
            const file = path.join(out, `render-${t}.png`);
            fs.writeFileSync(file, Buffer.from(png, "base64"));
            await page.js(`(async () => { ${LIVE} (await import(live("/src/engine/video/state.ts"))).vui.set({ time: ${t}, playing: false, selection: [] }); })()`);
            await page.wait(1500);
            const shot = path.join(out, `editor-${t}.png`);
            await page.shot(shot);
            result.frames.push(file, shot);
        }
    }
    return result;
};
module.exports.PRODUCTS = PRODUCTS;
module.exports.PLAN = PLAN;
module.exports.BUILD = BUILD;

// `node eight-products-video.cjs --snippet` prints the page code alone, for building the project
// in your own browser: open http://localhost:5310/?new=video, add the eight loop-*.mp4 files from
// apps/landing/img with Import media, then paste the code into the developer console.
if (require.main === module && process.argv.includes("--snippet")) process.stdout.write(BUILD([]) + "\n");

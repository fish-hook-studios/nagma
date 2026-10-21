// Slides: ?new=slides, "Ramayana hype deck". Setup (not recorded): six slides built from the deck's
// own layers (blank slides with an illustration fill, text and rectangles, as the Slides tools add
// them) in a poster style: six cream, vermilion and blue illustrations (assets/ramayana-*.webp),
// vermilion condensed display type, blue labels, small arrows, dotted rules and a barcode strip. Recorded: slide 1
// in full; slide 2 picked in the filmstrip and (zoomed in) its line finished with " Again."; slides
// 3, 4 and 5 clicked through; then Present and one advance to the last slide.
const { openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");
// The six illustrations, as data URLs, handed to the page.
const IMAGES = [1, 2, 3, 4, 5, 6].map((k) => "data:image/webp;base64," + fs.readFileSync(path.join(__dirname, "assets", `ramayana-${k}.webp`)).toString("base64"));

const SETUP = `(async () => {
  const IMAGES = ${JSON.stringify(IMAGES)};
  const [{ makeNode }, { solid }, M, F, files] = await Promise.all([import("/src/engine/nodes.ts"), import("/src/engine/paint.ts"), import("/src/slides/model.ts"), import("/src/engine/fonts.ts"), import("/src/engine/files.ts")]);
  await new Promise((r) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; r(); } }, 4000); F.ensureFont("Anton", () => { if (!done) { done = true; clearTimeout(t); r(); } }); });
  const CREAM = "#E8E2B8", VERM = "#C8372D", BLUE = "#1F3A8A", NAVY = "#152A66", INK = "#2A2A2A";
  let doc = nagma.get().doc;
  const page = M.deckPage(doc);
  nagma.execute({ type: "node.update", id: page.id, patch: { deck: { ...page.deck, picker: false } } });
  nagma.execute({ type: "doc.rename", name: "Ramayana hype deck" });
  try { files.renameFile(nagma.get().fileId, "Ramayana hype deck"); } catch (e) {}
  // Six blank slides (the first one's title layout cleared).
  let ids = M.slideIds(nagma.get().doc);
  const first = nagma.get().doc.nodes[ids[0]];
  if (first.children.length) nagma.execute({ type: "node.delete", ids: [...first.children] });
  nagma.execute({ type: "node.update", id: ids[0], patch: { deck: { ...first.deck, layout: "blank" } } });
  let last = ids[0];
  for (let i = 1; i < 6; i++) { const r = M.addSlideCommands(nagma.get().doc, "blank", last, undefined, true); nagma.execute({ type: "batch", commands: r.commands }); last = r.id; }
  nagma.execute({ type: "batch", commands: M.tidyCommands(nagma.get().doc) });
  ids = M.slideIds(nagma.get().doc);
  const S = ids.map((id) => nagma.get().doc.nodes[id]);
  const add = (type, s, x, y, w, h, o) => { const n = makeNode(nagma.get().doc, type, { x: s.x + x, y: s.y + y, w, h }, s.id, o); nagma.execute({ type: "node.create", node: n }); return n.id; };
  const rect = (s, x, y, w, h, fill, o = {}) => add("rect", s, x, y, w, h, { name: o.name || "Shape", fills: fill ? [solid(fill)] : [], radius: o.radius || 0, ...(o.stroke ? { strokes: [solid(o.stroke)], strokeWidth: o.sw || 3 } : {}), ...(o.opacity ? { opacity: o.opacity } : {}) });
  const oval = (s, x, y, w, h, fill, o = {}) => add("ellipse", s, x, y, w, h, { name: o.name || "Circle", fills: [solid(fill)], ...(o.arc ? { arc: o.arc } : {}), ...(o.opacity ? { opacity: o.opacity } : {}) });
  const text = (s, x, y, value, o) => add("text", s, x, y, o.w || 400, o.size * 1.2, { name: o.name || value.slice(0, 24), text: value, fills: [solid(o.color)], fontFamily: o.font || "Inter", fontSize: o.size, fontWeight: o.weight || 400, lineHeight: o.lh || 1.15, letterSpacing: o.ls || 0, textAlign: o.align || "left", sizing: o.w ? { h: "fixed", v: "hug" } : { h: "hug", v: "hug" } });
  const display = (s, x, y, value, size, w, color = VERM) => text(s, x, y, value, { font: "Anton", size, weight: 400, color, lh: 0.98, ls: 0, w, name: "Headline" });
  // The six illustrations (assets/ramayana-*.webp), one per slide, cropped to cover the slide.
  const { storeDataUrl } = await import("/src/engine/image-store.ts");
  const { imagePaint } = await import("/src/engine/paint.ts");
  const refs = await Promise.all(IMAGES.map((d) => storeDataUrl(d)));
  const picture = (s, k) => { const id = "ramayana-" + (k + 1); nagma.execute({ type: "image.add", id, data: refs[k] }); add("rect", s, 0, 0, s.w, s.h, { name: "Illustration", fills: [imagePaint(id, "fill")] }); };
  // Texture on every slide: a label, the page count, a dotted rule, small arrows and a barcode.
  const texture = (s, i, c) => {
    text(s, 96, 64, "RAMAYANA · HYPE DECK", { size: 22, weight: 700, color: c, ls: 6 });
    text(s, 1680, 64, "0" + (i + 1) + " / 06", { size: 22, weight: 700, color: c, ls: 4, w: 144, align: "right" });
    text(s, 96, 104, "· · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·", { size: 22, weight: 700, color: c, w: 1728, name: "Dotted rule" });
    text(s, 96, 980, "→ → →", { size: 26, weight: 700, color: c, ls: 4, name: "Arrows" });
    const bars = [3, 6, 2, 2, 8, 3, 2, 5, 2, 7, 3, 2, 4, 9, 2, 3, 6, 2, 3, 5, 2, 8];
    let bx = 1640;
    bars.forEach((w, k) => { rect(s, bx, 968, w, 52, c, { name: "Bar" }); bx += w + (k % 3 === 0 ? 5 : 3); });
  };
  S.forEach((s, i) => { nagma.execute({ type: "node.update", id: s.id, patch: { fills: [solid(CREAM)] } }); picture(s, i); texture(s, i, i === 4 ? CREAM : BLUE); });
  const [s1, s2, s3, s4, s5, s6] = S;
  // 1: the open book. The title in the empty left half.
  display(s1, 96, 300, "RAMAYANA", 210, 0, BLUE);
  text(s1, 104, 580, "Big epic. Bigger expectations.", { size: 52, weight: 800, color: VERM, ls: -1, w: 620, lh: 1.05 });
  text(s1, 106, 720, "A very unofficial hype deck.", { size: 28, weight: 500, color: BLUE });
  // 2: the bow against the sun.
  display(s2, 96, 200, "WE KNOW THE STORY. WE STILL WANT THE BIG-SCREEN MOMENT.", 100, 860);
  text(s2, 100, 650, "Some stories are worth gathering for.", { size: 40, weight: 600, color: BLUE, w: 860, name: "Body" });
  // 3: the river at sunset, three wish cards over the forest.
  display(s3, 96, 190, "OUR WISHLIST IS PERFECTLY REASONABLE.", 100, 1100);
  ["Goosebumps.", "Worlds worth getting lost in.", "A soundtrack that follows us home."].forEach((t, k) => {
    rect(s3, 96 + k * 588, 600, 556, 280, k === 1 ? BLUE : "#F3EED2", { name: "Card", radius: 28, stroke: k === 1 ? null : BLUE, sw: 3 });
    text(s3, 96 + k * 588 + 40, 636, "0" + (k + 1), { size: 26, weight: 800, color: k === 1 ? CREAM : VERM });
    text(s3, 96 + k * 588 + 40, 690, t, { size: 44, weight: 700, color: k === 1 ? CREAM : BLUE, w: 470, lh: 1.1 });
  });
  text(s3, 100, 905, "Okay, maybe slightly unreasonable.", { size: 26, weight: 600, color: "#F3EED2" });
  // 4: tickets and bubbles. The chat on the empty left.
  display(s4, 96, 180, "THE REAL CHALLENGE? GETTING EVERYONE TO THE SAME SHOW.", 80, 680);
  [["First day?", 100, 600, BLUE, CREAM], ["No spoilers.", 470, 600, "#F3EED2", BLUE], ["Who's booking?", 100, 724, BLUE, CREAM], ["Guys?", 580, 724, VERM, CREAM]].forEach(([t, x, y, bg, fg]) => {
    const w = t.length * 23 + 84;
    rect(s4, x, y, w, 104, bg, { name: "Bubble", radius: 40, stroke: bg === "#F3EED2" ? BLUE : null, sw: 3 });
    text(s4, x + 42, y + 28, t, { size: 40, weight: 700, color: fg });
  });
  // 5: the cinema. Cream type on the dark wall.
  display(s5, 96, 170, "BIG SCREEN. PHONE AWAY. EXPECTATIONS VERY MUCH PRESENT.", 92, 760, CREAM);
  text(s5, 100, 600, "Let the story do the talking.", { size: 36, weight: 600, color: CREAM });
  // 6: the city across the river.
  display(s6, 96, 140, "SOME STORIES STAY WITH US. HERE'S TO SEEING THEM ANEW.", 76, 900);
  text(s6, 100, 302, "See you at the movies.", { size: 34, weight: 800, color: BLUE });
  nagma.refreshText && nagma.refreshText();
  nagma.set({ selection: [] });
  const body = Object.values(nagma.get().doc.nodes).find((n) => n.parentId === s2.id && n.name === "Body");
  return { ids, body: body.id };
})()`;

module.exports = async function slidesScene(page) {
    await openNew(page, "slides");
    await page.wait(1200);
    const ids = await page.js(SETUP);
    await page.wait(1200);
    const one = await page.rect("label=Slide 1");
    await page.click(one.cx, one.cy, { ms: 1, pause: 40 });
    await page.wait(400);
    await page.key("Escape");
    await page.move(760, 640, 1);
    await page.wait(800);
    page.start();
    await page.wait(1300);
    // Slide 2, and (zoomed in) its line finished.
    await page.clickEl("label=Slide 2", { ms: 700, pause: 80 });
    await page.wait(500);
    // The slide view draws the current slide fitted in the big canvas (not by the file's camera):
    // its rect, measured, and the body's place in it.
    const b = await page.js(`(() => { const cv = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0].getBoundingClientRect(); const d = nagma.get().doc; const n = d.nodes[${JSON.stringify(ids.body)}]; const s = d.nodes[n.parentId]; const k = 768 / s.w; const x = 256 + (n.x - s.x) * k, y = 108 + (n.y - s.y) * k, w = n.w * k, h = n.h * k; return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h, cv: [cv.left, cv.top, cv.width, cv.height] }; })()`);
    await Promise.all([page.zoom(b.x + b.w * 0.6, b.cy - 40, 1.5, 850), page.move(b.right - 30, b.cy, 800)]);
    await page.anchor('[data-region="canvas"]');
    await page.click(b.right - 30, b.cy, { ms: 120, count: 2, pause: 60 });
    await page.wait(200);
    await page.key("End", ["meta"]);
    await page.type(" Again.", 70);
    await page.mark("slide");
    await page.wait(500);
    await page.key("Escape");
    await page.key("Escape");
    await page.anchor(null);
    await Promise.all([page.unzoom(800), page.move(150, 470, 800)]);
    // Through the filmstrip.
    for (const n of [3, 4, 5]) {
        await page.clickEl(`label=Slide ${n}`, { ms: 550, pause: 70 });
        await page.wait(650);
    }
    // Present, and one advance to the last slide.
    const present = await page.rect("label=Present");
    await page.click(present.cx, present.cy, { ms: 750, pause: 80 });
    await page.wait(1100);
    await page.click(900, 520, { ms: 500, pause: 60 });
    await page.wait(1300);
};
module.exports.SETUP = SETUP;
module.exports.opts = { duration: 14, posterMark: "slide", posterDelay: 0.5 };

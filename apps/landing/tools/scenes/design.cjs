// Design: "Bhramayugam", an eight-screen mobile app concept for a Kerala folk-horror film, built
// from a design handoff (assets/bhramayugam: the artwork as webp, the plan, lock, dials, viewfinder
// and icons as SVG). Setup (not recorded): a blank file gets the eight 390x844 screens in a row on
// a page named Bhramayugam, all real layers: full-bleed artwork or the carved surface, scrims so the
// titles read, a status row, back and info icons, Cormorant Garamond titles, IM Fell English copy,
// DM Sans utility text; the floor plan with its four room thumbnails placed from the handoff's
// hotspot percentages, the three story rows as an auto layout list, the gramophone with a waveform
// and the player ring, the lock plate with its three dials, the parchment collage, the lantern
// corridor with the viewfinder and camera controls, the loop wall with "Begin again".
// Recorded: all eight screens fitted; "03 Stories buried here" is selected by its name and zoomed
// to (⇧2), the recorder zooms in on the screen and the right panel, a story row is clicked, Esc
// climbs to the Stories list and its auto layout gap is scrubbed so the rows reflow; back out, Esc
// clears the selection and ⇧1 fits all eight screens again.
const { frameView, nodeRect, openBlank, setMe } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "assets", "bhramayugam");
const ART = ["entrance", "carved-surface", "granary", "courtyard", "prayer-room", "thevan-vessel", "cooking-pot", "gramophone", "lantern-corridor", "loop-wall", "parchment", "leaf"];
const IMAGES = Object.fromEntries(ART.map((k) => [k, "data:image/webp;base64," + fs.readFileSync(path.join(DIR, `${k}.webp`)).toString("base64")]));
const SVG = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith(".svg")).map((f) => [f.slice(0, -4), fs.readFileSync(path.join(DIR, f), "utf8")]));
const HOTSPOTS = JSON.parse(fs.readFileSync(path.join(DIR, "room-hotspots.json"), "utf8"));

const PALETTE = { soot: "#090A08", charcoal: "#171713", ivory: "#E7DDC5", parchment: "#C7BCA5", brass: "#92784E", bronze: "#483A26", amber: "#C48B42", record: "#C83D32", ink: "#30281D" };

const SETUP = `(async () => {
  const P = ${JSON.stringify(PALETTE)};
  const IMAGES = ${JSON.stringify(IMAGES)};
  const SVG = ${JSON.stringify(SVG)};
  const HOTSPOTS = ${JSON.stringify(HOTSPOTS)};
  const [{ applyCommand }, { makeNode }, { solid, imagePaint, linearGradient }, { storeDataUrl }, F, files] = await Promise.all([import("/src/engine/commands.ts"), import("/src/engine/nodes.ts"), import("/src/engine/paint.ts"), import("/src/engine/image-store.ts"), import("/src/engine/fonts.ts"), import("/src/engine/files.ts")]);
  const load = (f) => new Promise((r) => { const t = setTimeout(r, 8000); F.ensureFont(f, () => { clearTimeout(t); r(); }); });
  await Promise.all(["Cormorant Garamond", "IM Fell English", "DM Sans"].map(load));
  await Promise.all([["Cormorant Garamond", 600], ["Cormorant Garamond", 500], ["DM Sans", 500], ["DM Sans", 400], ["IM Fell English", 400]].map(([f, w]) => document.fonts.load(w + ' 16px "' + f + '"').catch(() => null)));
  await document.fonts.load('italic 400 16px "IM Fell English"').catch(() => null);

  let doc = { name: "Bhramayugam", nodes: {}, roots: [], images: {} };
  const ids = {};
  // Pictures and icons, stored as media and added to the file. An icon is an SVG with its
  // currentColor replaced and a pixel size set (twice the layer's), so it rasterises crisply.
  const stored = {};
  const image = async (key) => {
    if (!stored[key]) { stored[key] = await storeDataUrl(IMAGES[key]); doc = applyCommand(doc, { type: "image.add", id: "bh-" + key, data: stored[key] }); }
    return "bh-" + key;
  };
  for (const k of Object.keys(IMAGES)) await image(k);
  const icon = async (key, color, w, h) => {
    const id = "bh-" + key + "-" + color.slice(1) + "-" + w;
    if (!stored[id]) {
      const svg = SVG[key].replace(/currentColor/g, color).replace("<svg ", '<svg width="' + w * 2 + '" height="' + h * 2 + '" ');
      stored[id] = await storeDataUrl("data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))));
      doc = applyCommand(doc, { type: "image.add", id, data: stored[id] });
    }
    return id;
  };

  const add = (type, rect, parentId, o = {}) => {
    const parent = parentId ? doc.nodes[parentId] : undefined;
    const placed = parent && parent.type !== "page" ? { ...rect, x: rect.x + parent.x, y: rect.y + parent.y } : rect;
    const node = makeNode(doc, type, placed, parentId, o);
    doc = applyCommand(doc, { type: "node.create", node });
    if (o.name) ids[o.name] = node.id;
    return node.id;
  };
  const text = (parent, x, y, value, o = {}) => add("text", { x, y, w: o.w || 10, h: o.h || 10 }, parent, {
    name: o.name || value.replace(/\\n/g, " ").slice(0, 28), text: value, fills: [solid(o.color || P.ivory)], fontFamily: o.font || "IM Fell English", fontSize: o.size || 16, fontWeight: o.weight || 400,
    lineHeight: o.lh ?? null, letterSpacing: o.ls ?? 0, textAlign: o.align || "left", ...(o.upper ? { textCase: "upper" } : {}), ...(o.italic ? { italic: true } : {}),
    sizing: o.w ? { h: "fixed", v: "hug" } : { h: "hug", v: "hug" }, ...(o.extra || {}),
  });
  const title = (s, value, y = 100, size = 34) => text(s, 20, y, value, { font: "Cormorant Garamond", size, weight: 600, w: 350, align: "center", lh: 1.08, name: "Title" });
  const subtitle = (s, value, y = 148) => text(s, 20, y, value, { size: 15, color: P.parchment, w: 350, align: "center", name: "Subtitle" });
  const row = (gap, pad, extra = {}) => ({ direction: "horizontal", gap, padding: pad, primary: "start", counter: "center", ...extra });
  const col = (gap, pad, extra = {}) => ({ direction: "vertical", gap, padding: pad, primary: "start", counter: "start", ...extra });
  const scrim = (s, name, y, h, top) => {
    const g = linearGradient(P.soot, P.soot);
    g.stops = top ? [{ position: 0, color: P.soot, opacity: 0.92 }, { position: 1, color: P.soot, opacity: 0 }] : [{ position: 0, color: P.soot, opacity: 0 }, { position: 1, color: P.soot, opacity: 0.9 }];
    return add("rect", { x: 0, y, w: 390, h }, s, { name, fills: [g] });
  };
  const pic = async (parent, x, y, w, h, key, name, o = {}) => add("rect", { x, y, w, h }, parent, { name, fills: [{ ...imagePaint(await image(key), o.mode || "fill"), ...(o.crop ? { mode: "crop", crop: o.crop } : {}) }], ...(o.extra || {}) });
  const glyph = async (parent, x, y, w, h, key, color, name, extra = {}) => add("rect", { x, y, w, h }, parent, { name, fills: [imagePaint(await icon(key, color, w, h), "fit")], ...extra });
  const status = (s) => { text(s, 24, 16, "9:41", { font: "DM Sans", size: 14, weight: 500, name: "Time" }); add("rect", { x: 342, y: 19, w: 22, h: 11 }, s, { name: "Battery", fills: [], strokes: [solid(P.ivory)], strokeWidth: 1, radius: 3 }); add("rect", { x: 344, y: 21, w: 15, h: 7 }, s, { name: "Battery level", fills: [solid(P.ivory)], radius: 1.5 }); };
  const nav = async (s) => { await glyph(s, 20, 54, 24, 24, "back", P.ivory, "Back"); await glyph(s, 346, 54, 24, 24, "info", P.ivory, "Info"); };
  const framedButton = async (s, y, label, name) => {
    const b = add("frame", { x: 35, y, w: 320, h: 52 }, s, { name: "Button: " + label, fills: [solid(P.soot, 0.75)], clip: false });
    await glyph(b, 0, 0, 320, 52, "ornate-button-frame", P.brass, "Button frame");
    text(b, 0, 13, label, { font: "Cormorant Garamond", size: 21, weight: 600, w: 320, align: "center", name: "Label" });
    return b;
  };
  const ornament = async (s, y, color = P.brass, size = 20) => glyph(s, 195 - size / 2, y, size, size, "ornament", color, "Ornament");

  const page = add("page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Bhramayugam", fills: [solid("#1C1B18")] });
  const W = 390, H = 844, GAP = 60;
  const screen = (i, name) => add("frame", { x: i * (W + GAP), y: 0, w: W, h: H }, page, { name, fills: [solid(P.soot)], clip: true });
  const carved = async (s) => { await pic(s, 0, 0, W, H, "carved-surface", "Carved surface"); add("rect", { x: 0, y: 0, w: W, h: H }, s, { name: "Darken", fills: [solid(P.soot, 0.35)] }); };

  // 01 Enter the Mana: the title over the gate.
  {
    const s = screen(0, "01 Enter the Mana");
    await pic(s, 0, 0, W, H, "entrance", "Entrance artwork");
    scrim(s, "Top scrim", 0, 300, true);
    scrim(s, "Bottom scrim", 640, 204, false);
    status(s);
    text(s, 10, 98, "Bhramayugam", { font: "Cormorant Garamond", size: 38, weight: 600, w: 370, align: "center", ls: 7, upper: true, lh: 1.1, name: "Title" });
    text(s, 20, 160, "Enter the Mana", { size: 18, color: P.parchment, w: 350, align: "center", ls: 16, name: "Subtitle" });
    await ornament(s, 198, P.record, 14);
    await framedButton(s, 744, "Enter", "Enter");
  }
  // 02 The Mana: the floor plan and its rooms.
  {
    const s = screen(1, "02 The Mana");
    await carved(s);
    status(s);
    await nav(s);
    title(s, "The Mana");
    subtitle(s, "Explore its rooms. Some remember you.");
    const plan = add("frame", { x: 35, y: 190, w: 320, h: 412 }, s, { name: "Floor plan", fills: [], clip: false });
    await glyph(plan, 0, 0, 320, 412, "mana-plan", P.brass, "Plan drawing");
    const rooms = { granary: ["granary", "Granary"], "inner-court": ["courtyard", "Inner Court"], "prayer-room": ["prayer-room", "Prayer Room"], "locked-chamber": ["prayer-room", "The Locked Chamber"] };
    for (const h of HOTSPOTS) {
      const [key, label] = rooms[h.id];
      const x = Math.round(h.leftPercent / 100 * 320), y = Math.round(h.topPercent / 100 * 412), w = Math.round(h.widthPercent / 100 * 320), hh = Math.round(h.heightPercent / 100 * 412);
      const r = add("frame", { x, y, w, h: hh }, plan, { name: "Room: " + label, fills: [], clip: false });
      await pic(r, 0, 0, w, 56, key, label + " photo", h.id === "locked-chamber" ? { crop: [0.55, 0, 0.05, 0, 0.55, 0.4] } : {});
      add("rect", { x: 0, y: 0, w, h: 56 }, r, { name: label + " frame", fills: h.id === "locked-chamber" ? [solid(P.soot, 0.45)] : [], strokes: [solid(P.brass)], strokeWidth: 1 });
      text(r, -6, 61, label, { size: 12, color: P.parchment, w: w + 12, align: "center", lh: 1.15, name: label + " label" });
    }
    await ornament(s, 626);
    await framedButton(s, 744, "Choose a path");
  }
  // 03 Stories buried here: three story rows in an auto layout list.
  {
    const s = screen(2, "03 Stories buried here");
    await carved(s);
    status(s);
    await nav(s);
    title(s, "Stories buried here");
    subtitle(s, "Voices linger even in silence.");
    const list = add("frame", { x: 24, y: 196, w: 342, h: 520 }, s, { name: "Stories", fills: [], clip: false, layout: col(16, [0, 0, 0, 0]), sizing: { h: "fixed", v: "hug" } });
    const stories = [["Thevan", "A singer who entered and never left.", "thevan-vessel"], ["The Cook", "He feeds, he watches, he changes.", "cooking-pot"], ["The Lord of the Mana", "Many forms. One hunger.", "courtyard"]];
    for (const [name, line, key] of stories) {
      const card = add("frame", { x: 0, y: 0, w: 342, h: 150 }, list, { name: "Story: " + name, fills: [solid(P.charcoal)], strokes: [solid(P.brass, 0.7)], strokeWidth: 1, clip: true, layout: row(16, [0, 16, 0, 0]), sizing: { h: "fixed", v: "fixed" } });
      await pic(card, 0, 0, 132, 150, key, name + " picture", { extra: { sizing: { h: "fixed", v: "fill" } } });
      const copy = add("frame", { x: 0, y: 0, w: 150, h: 80 }, card, { name: name + " text", fills: [], clip: false, layout: col(6, [0, 0, 0, 0]), sizing: { h: "fill", v: "hug" } });
      text(copy, 0, 0, name, { font: "Cormorant Garamond", size: 24, weight: 600, lh: 1.05, name: name + " title", extra: { sizing: { h: "fill", v: "hug" } } });
      text(copy, 0, 0, line, { size: 13, color: P.parchment, lh: 1.4, name: name + " line", extra: { sizing: { h: "fill", v: "hug" } } });
      await glyph(card, 0, 0, 18, 18, "chevron", P.parchment, name + " chevron");
      // Torn parchment edges along the top and bottom of the card.
      await pic(card, 0, 0, 342, 7, "parchment", name + " top edge", { extra: { positioning: "absolute" } });
    }
  }
  // 04 Paattu: the gramophone, a waveform and the player.
  {
    const s = screen(3, "04 Paattu");
    await pic(s, 0, 0, W, H, "gramophone", "Gramophone artwork");
    scrim(s, "Top scrim", 0, 260, true);
    scrim(s, "Bottom scrim", 500, 344, false);
    status(s);
    await nav(s);
    title(s, "Paattu");
    subtitle(s, "Songs travel further than men.");
    const wave = add("frame", { x: 85, y: 540, w: 220, h: 36 }, s, { name: "Waveform", fills: [], clip: false, layout: row(2, [0, 0, 0, 0], { primary: "center" }), sizing: { h: "fixed", v: "fixed" } });
    const hs = [6, 10, 16, 9, 22, 14, 30, 18, 12, 26, 34, 20, 10, 16, 28, 36, 24, 12, 18, 30, 22, 8, 14, 26, 32, 16, 10, 20, 28, 12, 18, 8, 14, 22, 10, 6];
    hs.forEach((h, i) => add("rect", { x: 0, y: 0, w: 3, h }, wave, { name: "Bar " + (i + 1), fills: [solid(i < 14 ? P.ivory : P.parchment, i < 14 ? 0.9 : 0.45)], radius: 1.5 }));
    await glyph(s, 118, 594, 16, 16, "headphones", P.parchment, "Headphones icon");
    text(s, 142, 594, "Listen with headphones.", { font: "DM Sans", size: 12, color: P.parchment, name: "Hint" });
    const player = add("frame", { x: 95, y: 628, w: 200, h: 104 }, s, { name: "Player", fills: [], clip: false });
    await glyph(player, 0, 44, 36, 16, "ornament", P.brass, "Left flourish");
    await glyph(player, 164, 44, 36, 16, "ornament", P.brass, "Right flourish");
    await glyph(player, 48, 0, 104, 104, "player-ring", P.brass, "Player ring");
    add("ellipse", { x: 62, y: 14, w: 76, h: 76 }, player, { name: "Play button", fills: [solid(P.soot, 0.85)], strokes: [solid(P.amber)], strokeWidth: 1.5 });
    await glyph(player, 88, 38, 28, 28, "play", P.ivory, "Play icon");
    add("rect", { x: 60, y: 764, w: 270, h: 1 }, s, { name: "Seek track", fills: [solid(P.parchment, 0.4)] });
    add("ellipse", { x: 56, y: 760, w: 9, h: 9 }, s, { name: "Seek handle", fills: [solid(P.ivory)] });
    text(s, 20, 756, "0:00", { font: "DM Sans", size: 12, color: P.parchment, name: "Elapsed" });
    text(s, 340, 756, "6:24", { font: "DM Sans", size: 12, color: P.parchment, w: 30, align: "right", name: "Duration" });
  }
  // 05 The Locked Chamber: the lock plate and its three dials.
  {
    const s = screen(4, "05 The Locked Chamber");
    await carved(s);
    status(s);
    await nav(s);
    title(s, "The Locked Chamber");
    subtitle(s, "Nothing here opens easily.");
    const lock = add("frame", { x: 115, y: 196, w: 160, h: 420 }, s, { name: "Lock", fills: [], clip: false });
    await glyph(lock, 0, 0, 160, 420, "lock-plate", P.brass, "Lock plate");
    for (const [i, [key, name]] of [["dial-sun", "Dial: sun"], ["dial-bird", "Dial: bird"], ["dial-lotus", "Dial: lotus"]].entries()) await glyph(lock, 24, 38 + i * 116, 112, 112, key, P.brass, name);
    add("ellipse", { x: 300, y: 490, w: 44, h: 44 }, s, { name: "Reset button", fills: [solid(P.soot, 0.7)], strokes: [solid(P.brass)], strokeWidth: 1 });
    await glyph(s, 312, 502, 20, 20, "reset", P.ivory, "Reset icon");
    const note = add("frame", { x: 40, y: 652, w: 310, h: 96 }, s, { name: "Parchment note", fills: [], clip: false });
    await pic(note, 0, 0, 310, 96, "parchment", "Parchment", { crop: [1, 0, 0, 0, 0.3, 0.33] });
    text(note, 20, 34, "The walls remember.", { size: 19, italic: true, color: P.ink, w: 270, align: "center", name: "Note" });
    await ornament(s, 776, P.record, 14);
  }
  // 06 Fragments of memory: the parchment collage.
  {
    const s = screen(5, "06 Fragments of memory");
    await carved(s);
    status(s);
    await nav(s);
    title(s, "Fragments of memory");
    subtitle(s, "Pieces, not answers.");
    const sheet = add("frame", { x: 28, y: 192, w: 334, h: 620 }, s, { name: "Collage", fills: [], clip: false });
    await pic(sheet, 0, 0, 334, 620, "parchment", "Parchment sheet");
    await glyph(sheet, 14, 40, 18, 72, "key", P.bronze, "Key");
    await pic(sheet, 36, 28, 160, 112, "courtyard", "Photo: the courtyard", { extra: { rotation: -3, strokes: [solid(P.ivory)], strokeWidth: 3 } });
    await pic(sheet, 240, 22, 76, 96, "leaf", "Leaf", { mode: "fit", extra: { rotation: 10 } });
    await glyph(sheet, 160, 150, 56, 56, "spiral", P.bronze, "Spiral");
    await glyph(sheet, 238, 136, 64, 64, "memory-coin", P.bronze, "Coin");
    await glyph(sheet, 210, 220, 96, 128, "memory-figure", P.bronze, "Figure");
    await pic(sheet, 34, 300, 150, 112, "entrance", "Photo: the gate", { extra: { rotation: 2, strokes: [solid(P.ivory)], strokeWidth: 3 }, crop: [0.7, 0, 0.15, 0, 0.35, 0.38] });
    text(sheet, 46, 460, "The same courtyard.\\nA different moon.\\nAnd yet, I feel I have written\\nthis before.", { size: 14, italic: true, color: P.ink, lh: 1.5, w: 250, name: "Note" });
    await glyph(sheet, 158, 560, 14, 14, "ornament", P.record, "Ornament");
  }
  // 07 Do not look behind you: the lantern corridor, the viewfinder and the camera controls.
  {
    const s = screen(6, "07 Do not look behind you");
    await pic(s, 0, 0, W, H, "lantern-corridor", "Corridor artwork");
    scrim(s, "Top scrim", 0, 260, true);
    scrim(s, "Bottom scrim", 620, 224, false);
    status(s);
    await nav(s);
    title(s, "Do not look behind you", 100, 31);
    subtitle(s, "Some things prefer to be unseen.");
    const rec = add("frame", { x: 135, y: 190, w: 120, h: 20 }, s, { name: "Recording", fills: [], clip: false, layout: row(8, [0, 0, 0, 0], { primary: "center" }), sizing: { h: "fixed", v: "hug" } });
    add("ellipse", { x: 0, y: 0, w: 10, h: 10 }, rec, { name: "Record dot", fills: [solid(P.record)] });
    text(rec, 0, 0, "00:00:27", { font: "DM Sans", size: 14, weight: 500, name: "Timer" });
    await glyph(s, 35, 226, 320, 427, "viewfinder", P.ivory, "Viewfinder");
    const controls = add("frame", { x: 55, y: 724, w: 280, h: 68 }, s, { name: "Camera controls", fills: [], clip: false, layout: row(0, [0, 0, 0, 0], { primary: "between" }), sizing: { h: "fixed", v: "fixed" } });
    const round = async (d, key, name, strokeColor, iconColor, iconSize) => {
      const b = add("frame", { x: 0, y: 0, w: d, h: d }, controls, { name, fills: [], clip: false });
      add("ellipse", { x: 0, y: 0, w: d, h: d }, b, { name: name + " ring", fills: [solid(P.soot, 0.6)], strokes: [solid(strokeColor)], strokeWidth: 1.5 });
      if (key) await glyph(b, (d - iconSize) / 2, (d - iconSize) / 2, iconSize, iconSize, key, iconColor, name + " icon");
      return b;
    };
    await round(48, "gallery", "Gallery", P.brass, P.ivory, 22);
    const stop = await round(68, null, "Stop", P.ivory, P.ivory, 0);
    add("rect", { x: 24, y: 24, w: 20, h: 20 }, stop, { name: "Stop square", fills: [solid(P.record)], radius: 2 });
    await round(48, "switch-camera", "Switch camera", P.brass, P.ivory, 22);
  }
  // 08 You have been here before: the loop wall.
  {
    const s = screen(7, "08 You have been here before");
    await pic(s, 0, 0, W, H, "loop-wall", "Loop wall artwork");
    scrim(s, "Top scrim", 0, 300, true);
    scrim(s, "Bottom scrim", 600, 244, false);
    status(s);
    text(s, 20, 96, "You have been\\nhere before.", { font: "Cormorant Garamond", size: 36, weight: 600, w: 350, align: "center", lh: 1.08, name: "Title" });
    subtitle(s, "Time folds. The Mana remains.", 186);
    await ornament(s, 700, P.record, 14);
    await framedButton(s, 744, "Begin again");
  }

  nagma.loadDocument(doc);
  nagma.refreshText && nagma.refreshText();
  nagma.set({ selection: [] });
  try { nagma.execute({ type: "doc.rename", name: "Bhramayugam" }); files.renameFile(nagma.get().fileId, "Bhramayugam"); } catch (e) {}
  const N = nagma.get().doc.nodes;
  const out = {};
  for (const [name, id] of Object.entries(ids)) if (N[id]) out[name] = id;
  return out;
})()`;

const SCREENS = ["01 Enter the Mana", "02 The Mana", "03 Stories buried here", "04 Paattu", "05 The Locked Chamber", "06 Fragments of memory", "07 Do not look behind you", "08 You have been here before"];

async function build(page) {
    await openBlank(page);
    await setMe(page);
    const ids = await page.js(SETUP);
    await page.wait(600);
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
    await page.wait(400);
    return ids;
}

module.exports = async function design(page) {
    const ids = await build(page);
    // All eight screens in a row.
    await frameView(page, { x: 0, y: 0, w: 8 * 390 + 7 * 60, h: 844, margin: 30, offsetY: -16 });
    await page.wait(600);
    const stories = await nodeRect(page, ids["03 Stories buried here"]);
    await page.move(stories.cx + 40, stories.bottom + 60, 1);
    page.start();
    await page.wait(700);
    // The screen, by its name above it.
    await page.click(stories.x + 6, stories.y - 6, { ms: 800, pause: 100 });
    await page.wait(500);
    // Zoom to it (⇧2), then the recorder leans in on the screen and the right panel.
    await page.key("2", ["shift"]);
    await page.wait(700);
    const list = await nodeRect(page, ids.Stories);
    await Promise.all([page.zoom(840, list.cy, 1.4, 900), page.move(list.cx, list.y - 30, 850)]);
    await page.anchor('[data-region="canvas"]');
    const card = await nodeRect(page, ids["Story: Thevan"]);
    await page.click(card.x + card.w * 0.55, card.y + card.h * 0.9, { ms: 650, pause: 100 });
    await page.wait(500);
    await page.key("Escape");
    await page.wait(600);
    // Scrub the gap: the rows spread out, then settle.
    await page.anchor(null);
    const sel = 'label[title="Gap between items"] > span:first-of-type';
    const g = await page.waitFor(sel);
    await page.move(g.cx, g.cy, 800);
    await page.anchor(sel);
    await page.drag(g.cx, g.cy, g.cx + 18, g.cy, 1100, undefined, 60);
    await page.mark("gap");
    await page.wait(350);
    await page.drag(g.cx + 18, g.cy, g.cx + 6, g.cy, 650, undefined, 40);
    await page.anchor(null);
    await page.wait(500);
    await Promise.all([page.unzoom(900), page.move(stories.cx + 60, stories.bottom + 40, 900)]);
    await page.wait(300);
    // The first Escape leaves the gap field; the next two climb from the list to nothing selected.
    await page.key("Escape");
    await page.key("Escape");
    await page.key("Escape");
    await page.key("1", ["shift"]);
    await page.wait(1800);
};
module.exports.opts = { duration: 14, posterMark: "gap", posterDelay: 0.3, crf: 30 };
module.exports.SETUP = SETUP;
module.exports.build = build;
module.exports.SCREENS = SCREENS;

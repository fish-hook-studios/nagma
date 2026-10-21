// Video: ?new=video, the "YODHA" title card (assets/yodha.svg, a hand with the five Kalaripayattu
// stances lettered along its fingers and the name) as a short animation. Setup (not recorded): the
// SVG is split in the page into seven layers (the hand, the five words, the title), each drawn to a
// transparent full-frame picture and added to the project's media like any imported still, then laid on the
// timeline on their own tracks over the rust background: the hand rises in from below, the words pop
// in one after another around the fingers, and the title arrives last. Recorded: the title clip is
// picked on the timeline; Library › Motion › "Pop in" (double-clicked, zoomed in) gives it its
// entrance; then Play, and the whole piece plays in the monitor; the loop rests on the final frame.
const { openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

const SVG = fs.readFileSync(path.join(__dirname, "assets", "yodha.svg"), "utf8");

const SETUP = `(async () => {
  const SVG = ${JSON.stringify(SVG)};
  const [A, M, S, Fonts] = await Promise.all([import("/src/engine/video/actions.ts"), import("/src/engine/video/model.ts"), import("/src/engine/video/state.ts"), import("/src/engine/fonts.ts")]);
  const doc = new DOMParser().parseFromString(SVG, "image/svg+xml");
  const svg = doc.documentElement;
  const W = 1920, H = 1080;
  const paths = [...svg.querySelectorAll("path")];
  const titlePath = svg.querySelector("g[filter] path");
  const hand = paths.filter((p) => p !== titlePath).sort((a, b) => b.getAttribute("d").length - a.getAttribute("d").length)[0];
  const letters = paths.filter((p) => p !== titlePath && p !== hand);
  const at = (p) => { const m = /M\\s*([\\d.]+)[ ,]([\\d.]+)/.exec(p.getAttribute("d")); return { x: +m[1], y: +m[2] }; };
  // The five words, by where their letters sit on the hand: thumb, index finger arc, and the three
  // above the middle, ring and little fingers.
  const word = (p) => { const { x, y } = at(p); if (y > 700) return "Ashokan"; if (y >= 340 && x < 1500) return "Kadakathalozhival"; if (x < 1345) return "Ozhivu"; if (x < 1500) return "Kadakam"; return "Othiram"; };
  const groups = { Hand: [hand.outerHTML] };
  for (const p of letters) (groups[word(p)] ||= []).push(p.outerHTML);
  groups.YODHA = [svg.querySelector("g[filter]").outerHTML];
  const defs = svg.querySelector("defs")?.outerHTML ?? "";
  // Each layer drawn and kept as a PNG file, with where its pixels sit.
  const draw = (inner) => new Promise((resolve, reject) => {
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' + defs + inner + "</svg>");
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });
  const layers = [];
  for (const [name, parts] of Object.entries(groups)) {
    const img = await draw(parts.join(""));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    // Full-frame pictures (a still is fitted to the frame when drawn), each knowing its own centre.
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    layers.push({ name, file: new File([blob], name + ".png", { type: "image/png" }), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  await A.importFiles(layers.map((l) => l.file));
  await new Promise((r) => setTimeout(r, 300));
  // The timeline: every layer a clip on its own track, with its entrance keyed.
  let project = S.currentProject();
  let comp = { ...M.compById(project, "root"), background: "#AA3F25" };
  const media = (name) => project.media.find((m) => m.name === name + ".png");
  const key = (t, v, ease = "ease-in-out", bezier) => ({ t, v, ease, ...(bezier ? { bezier } : {}) });
  const plan = [
    ["Hand", 0, 6, (l) => ({ y: [key(0, l.cy + 900, "bezier", [0.22, 1, 0.36, 1]), key(0.9, l.cy)] })],
    ["Ashokan", 1.1, 4.9, (l) => pop(l)],
    ["Kadakathalozhival", 1.45, 4.55, (l) => pop(l)],
    ["Ozhivu", 1.8, 4.2, (l) => pop(l)],
    ["Kadakam", 2.15, 3.85, (l) => pop(l)],
    ["Othiram", 2.5, 3.5, (l) => pop(l)],
    ["YODHA", 3.4, 2.6, () => ({})],
  ];
  function pop() { return { opacity: [key(0, 0, "linear"), key(0.15, 100)], scaleX: [key(0, 0, "bezier", [0.34, 1.56, 0.64, 1]), key(0.45, 100)], scaleY: [key(0, 0, "bezier", [0.34, 1.56, 0.64, 1]), key(0.45, 100)] }; }
  const ids = {};
  // The hand on the lowest track, the title on the highest: tracks are added as each layer needs one.
  const E = await import("/src/engine/video/edit.ts");
  for (const [name, start, duration, anim] of plan) {
    const l = layers.find((x) => x.name === name), m = media(name);
    let track; ({ comp, track } = E.freeTrack(comp, "video", start, start + duration));
    // The anchor at the layer's own centre, so scaling pops the word in place.
    const clip = M.newClip("image", track, start, duration, name, { media: m.id, props: { x: l.cx, y: l.cy, anchorX: l.cx - W / 2, anchorY: l.cy - H / 2 }, anim: anim(l) });
    comp = { ...comp, clips: [...comp.clips, clip] };
    ids[name] = clip.id;
  }
  S.commitComp(comp, project);
  S.vui.set({ selection: [], time: 2.9, leftTab: "library", libraryTab: "motion" });
  try { nagma.execute({ type: "doc.rename", name: "Yodha title card" }); } catch (e) {}
  return ids;
})()`;

module.exports = async function videoScene(page) {
    await openNew(page, "video", "label=New title");
    await page.wait(300);
    const ids = await page.js(SETUP);
    await page.wait(900);
    // The title clip on the timeline (its label, in the lower half of the window).
    const clipRect = async () => (await page.all("text=YODHA")).filter((r) => r.y > 430).sort((a, b) => b.y - a.y)[0];
    let clip = await clipRect();
    if (!clip) throw new Error("YODHA clip not on the timeline");
    await page.move(760, 470, 1);
    page.start();
    await page.wait(500);
    await page.move(clip.cx, clip.cy, 700);
    await page.click(undefined, undefined, { pause: 60 });
    await page.wait(300);
    const sel = await page.js(`import("/src/engine/video/state.ts").then((S) => JSON.stringify(S.vui.get().selection))`);
    if (!String(sel).includes(ids.YODHA)) await page.js(`import("/src/engine/video/state.ts").then((S) => S.vui.set({ selection: [${JSON.stringify(ids.YODHA)}] }))`);
    // Library › Motion › Pop in, zoomed in on the row, double-clicked.
    const row = await page.waitFor("text=Pop in");
    await Promise.all([page.zoom(row.cx + 80, row.cy, 1.6, 750), page.move(row.cx, row.cy, 750)]);
    await page.anchor({ x: row.cx, y: row.cy });
    await page.click(row.cx, row.cy, { ms: 120, count: 2, pause: 60 });
    await page.anchor(null);
    await page.wait(250);
    const keyed = await page.js(`import("/src/engine/video/state.ts").then((S) => { const c = S.activeComp().clips.find((c) => c.id === ${JSON.stringify(ids.YODHA)}); return Boolean(c && c.anim.scaleX); })`);
    if (!keyed) await page.js(`import("/src/engine/video/actions.ts").then((A) => A.applyMotionPreset("pop-in"))`);
    await page.mark("popin");
    await page.wait(350);
    // Back out; the playhead home; Play, and the piece runs in the monitor.
    const play = await page.rect("label=Play");
    await page.js(`import("/src/engine/video/state.ts").then((S) => S.vui.set({ time: 0, selection: [] }))`);
    await Promise.all([page.unzoom(750), page.move(play.cx, play.cy, 750)]);
    await page.wait(150);
    await page.click(undefined, undefined, { pause: 60 });
    await page.mark("play");
    await page.move(play.cx + 90, play.cy + 40, 500);
    await page.wait(6300);
    // Parked on the last frame of the card (the sequence's end itself draws nothing).
    await page.js(`import("/src/engine/video/state.ts").then((S) => S.vui.set({ playing: false, time: 5.97 }))`);
    await page.mark("end");
    await page.wait(1500);
};
module.exports.opts = { duration: 14, posterMark: "end", posterDelay: 0.3 };

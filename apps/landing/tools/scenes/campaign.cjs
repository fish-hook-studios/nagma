// Campaign: ?new=campaign, a blank asset made a Story (1080 × 1920). Setup (not recorded): the
// "Thala" fan poster, built from sixteen image layers (assets/thala-*.webp, placed from the
// poster's layout: the deep purple background, the big green title, the fan line, the caption,
// the character, six badge pills and five accent rays), every layer its own image fill, the
// background stretched to the asset and the rest centred. Recorded: zoomed in on the poster, the
// "Born to Lead" badge (left near the bottom) is dragged to its place beside the shoe; Template ›
// Resize to… › Square, Portrait and Landscape; then the grid of sizes, the layers following their
// constraints into each shape.
const { openNew } = require("./_app.cjs");
const fs = require("fs");
const path = require("path");

// The poster's layers (from its layout.json, on a 942 × 1672 canvas), in stacking order.
const LAYERS = [
    ["01-background", 0, 0, 942, 1672],
    ["02-thala-title", 72, 220, 800, 685],
    ["03-fan-line", 72, 146, 800, 60],
    ["04-top-caption", 166, 76, 610, 35],
    ["05-mohanlal-anime", 155, 647, 760, 908],
    ["06-fort-kochis-own", 30, 695, 292, 138],
    ["07-gang-comes-first", 620, 710, 300, 130],
    ["08-full-time-chillu", 22, 940, 272, 134],
    ["09-comedy-mass", 690, 930, 247, 120],
    ["10-local-hero-energy", 30, 1200, 297, 138],
    ["11-born-to-lead", 688, 1315, 247, 128],
    ["12-accent-rays", 18, 701, 52, 48],
    ["13-accent-rays", 870, 690, 52, 48],
    ["14-accent-rays", 18, 918, 52, 48],
    ["15-accent-rays", 878, 904, 52, 48],
    ["16-accent-rays", 15, 1210, 52, 48],
];
const NAMES = {
    "01-background": "Background", "02-thala-title": "THALA", "03-fan-line": "Fan line", "04-top-caption": "All time favourite",
    "05-mohanlal-anime": "Thala", "06-fort-kochis-own": "Badge: Fort Kochi's Own", "07-gang-comes-first": "Badge: Gang Comes First",
    "08-full-time-chillu": "Badge: Full-Time Chillu", "09-comedy-mass": "Badge: Comedy + Mass", "10-local-hero-energy": "Badge: Local Hero Energy",
    "11-born-to-lead": "Badge: Born to Lead",
};
const IMAGES = LAYERS.map(([f]) => "data:image/webp;base64," + fs.readFileSync(path.join(__dirname, "assets", `thala-${f}.webp`)).toString("base64"));

const SETUP = `(async () => {
  const LAYERS = ${JSON.stringify(LAYERS.map(([f, x, y, w, h]) => [NAMES[f] || "Accent rays", x, y, w, h, /accent/.test(f)]))};
  const IMAGES = ${JSON.stringify(IMAGES)};
  const [{ makeNode }, { imagePaint }, { storeDataUrl }] = await Promise.all([import("/src/engine/nodes.ts"), import("/src/engine/paint.ts"), import("/src/engine/image-store.ts")]);
  const refs = await Promise.all(IMAGES.map((d) => storeDataUrl(d)));
  const doc = () => nagma.get().doc;
  const asset = Object.values(doc().nodes).find((n) => n.campaign && n.campaign.kind === "asset");
  // A Story, named for the poster.
  const W = 1080, H = 1920, k = W / 942, top = (H - 1672 * k) / 2;
  nagma.execute({ type: "node.update", id: asset.id, patch: { w: W, h: H, name: "Thala · Story", fills: [], campaign: { ...asset.campaign, preset: "story" } } });
  nagma.execute({ type: "doc.rename", name: "Thala fan posters" });
  const ids = {};
  LAYERS.forEach(([name, x, y, w, h, rays], i) => {
    const id = "thala-" + i;
    nagma.execute({ type: "image.add", id, data: refs[i] });
    const bg = i === 0;
    const box = bg ? { x: asset.x, y: asset.y, w: W, h: H } : { x: asset.x + x * k, y: asset.y + top + y * k, w: w * k, h: h * k };
    const n = makeNode(doc(), "rect", box, asset.id, { name, fills: [imagePaint(id, "fill")], constraints: bg ? { h: "left-right", v: "top-bottom" } : { h: "center", v: "center" }, ...(rays ? { locked: true } : {}) });
    nagma.execute({ type: "node.create", node: n });
    ids[name] = n.id;
  });
  // "Born to Lead" starts out of place: over the knee, lower left.
  const badge = doc().nodes[ids["Badge: Born to Lead"]];
  const home = { x: badge.x, y: badge.y };
  nagma.execute({ type: "node.update", id: badge.id, patch: { x: asset.x + 330 * k, y: asset.y + top + 1430 * k } });
  nagma.refreshText && nagma.refreshText();
  nagma.set({ selection: [] });
  return { asset: asset.id, badge: badge.id, home };
})()`;

// A node's rect on screen, from the canvas and camera.
const nodeRect = (page, id) => page.js(`(() => { const s = nagma.get(); const n = s.doc.nodes[${JSON.stringify(id)}]; const c = document.querySelector('[data-region="canvas"]') || document.querySelector("canvas"); const r = c.getBoundingClientRect(); const z = s.camera.zoom; const x = r.left + n.x * z + s.camera.x, y = r.top + n.y * z + s.camera.y, w = n.w * z, h = n.h * z; return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, z }; })()`);

module.exports = async function campaignScene(page) {
    await openNew(page, "campaign", "text=Blank asset");
    await page.clickEl("text=Blank asset", { ms: 1, pause: 40 });
    await page.wait(800);
    const ids = await page.js(SETUP);
    await page.wait(600);
    await page.key("Escape");
    // The poster fitted in the canvas.
    await page.js(`(() => { const s = nagma.get(); const a = s.doc.nodes[${JSON.stringify(ids.asset)}]; const c = document.querySelector('[data-region="canvas"]') || document.querySelector("canvas"); const r = c.getBoundingClientRect(); const z = Math.min((r.width - 120) / a.w, (r.height - 60) / a.h); nagma.set({ camera: { zoom: z, x: r.width / 2 - (a.x + a.w / 2) * z, y: r.height / 2 - (a.y + a.h / 2) * z } }); })()`);
    await page.wait(900);
    await page.move(1120, 640, 1);
    await page.wait(500);
    page.start();
    await page.wait(500);
    // In on the poster's lower half: the badge dragged to its place.
    const b = await nodeRect(page, ids.badge);
    const asset = await nodeRect(page, ids.asset);
    await Promise.all([page.zoom(asset.cx, asset.y + asset.h * 0.72, 1.4, 850), page.move(b.cx, b.cy, 800)]);
    await page.anchor('[data-region="canvas"]');
    await page.click(b.cx, b.cy, { ms: 1, pause: 60 });
    await page.wait(200);
    if (!(await page.js(`nagma.get().selection[0] === ${JSON.stringify(ids.badge)}`))) throw new Error("badge not selected");
    // Screen distances from before the zoom (the anchor maps them through it).
    const cur = await page.js(`(() => { const n = nagma.get().doc.nodes[${JSON.stringify(ids.badge)}]; return { x: n.x, y: n.y }; })()`);
    await page.drag(b.cx, b.cy, b.cx + (ids.home.x - cur.x) * b.z, b.cy + (ids.home.y - cur.y) * b.z, 1100, undefined, 1);
    await page.mark("badge");
    await page.wait(500);
    await page.anchor(null);
    // The asset itself selected (its toolbar has Template); then Template › Resize to… (make copies).
    await page.js(`nagma.set({ selection: [${JSON.stringify(ids.asset)}] })`);
    await page.wait(150);
    const tpl = await page.waitFor("label=Template");
    await Promise.all([page.unzoom(800), page.move(tpl.cx, tpl.cy, 800)]);
    await page.click(undefined, undefined, { pause: 80 });
    await page.wait(450);
    await page.clickEl("text=Resize to…", { ms: 650, pause: 80 });
    const square = await page.waitFor("text=Square post");
    await page.wait(300);
    await Promise.all([page.zoom(600, 395, 1.45, 800), page.move(square.cx, square.cy, 750)]);
    for (const t of ["Square post", "Portrait", "Landscape"]) {
        await page.clickEl(`text=${t}`, { ms: 450, pause: 60 });
        await page.wait(100);
    }
    await page.wait(150);
    const create = await page.rect("text=Create 3 copies");
    await Promise.all([page.unzoom(800), page.move(create.cx, create.cy, 800)]);
    await page.click(undefined, undefined, { pause: 80 });
    await page.wait(350);
    const grid = await page.rect("label=Grid view");
    await page.click(grid.cx, grid.cy, { ms: 750, pause: 80 });
    await page.mark("grid");
    await page.wait(300);
    await page.key("Escape");
    await page.move(760, 740, 600);
    await page.wait(700);
};
module.exports.opts = { duration: 14, posterMark: "grid", posterDelay: 0.9 };

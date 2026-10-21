// Design: the Vesta investing app starter file (?template=invest). Three of its screens in view;
// the Home screen is selected by its name, then (zoomed in on the screen and the Auto layout panel)
// a holding row is clicked, Esc climbs to the holdings list, ⇧A stacks it, and the gap is scrubbed
// so the rows reflow; back out and ⇧1 zooms to fit all ten screens.
// Setup (not recorded): the signed-in name reads Anjali Rao, and the four holding rows sit in one
// plain frame, "Holdings", so the list can become a stack.
const { frameView, nodeRect, setMe } = require("./_app.cjs");

const SETUP = `(async () => {
  const { applyCommand } = await import("/src/engine/commands.ts");
  const { makeNode } = await import("/src/engine/nodes.ts");
  let doc = nagma.get().doc;
  const all = () => Object.values(doc.nodes);
  for (const n of all()) {
    if (n.type === "text" && n.text === "Ava Chen") doc = applyCommand(doc, { type: "node.update", id: n.id, patch: { text: "Anjali Rao", name: "User name" } });
    if (n.type === "text" && n.text === "ava@example.com") doc = applyCommand(doc, { type: "node.update", id: n.id, patch: { text: "anjali@example.com" } });
  }
  const home = all().find((n) => n.type === "frame" && n.name === "03 Home");
  const rows = home.children.map((id) => doc.nodes[id]).filter((n) => n.name.startsWith("Holding "));
  const top = Math.min(...rows.map((r) => r.y)), bottom = Math.max(...rows.map((r) => r.y + r.h));
  const wrap = makeNode(doc, "frame", { x: rows[0].x, y: top, w: rows[0].w, h: bottom - top }, home.id, { name: "Holdings", fills: [], clip: false });
  doc = applyCommand(doc, { type: "node.create", node: wrap, index: home.children.indexOf(rows[0].id) });
  for (const r of rows) doc = applyCommand(doc, { type: "node.reparent", id: r.id, parentId: wrap.id });
  nagma.loadDocument(doc);
  const ids = {};
  for (const n of Object.values(nagma.get().doc.nodes)) if (["03 Home", "02 Sign in", "04 Portfolio", "Holdings", "Holding AAPL", "Holding NVDA"].includes(n.name)) ids[n.name] = n.id;
  ids.home = { x: home.x, y: home.y, w: home.w, h: home.h };
  return ids;
})()`;

module.exports = async function design(page) {
    await page.win.loadURL("http://localhost:5310/?template=invest");
    await page.waitFor("text=Layers", 20000);
    await setMe(page);
    await page.wait(800);
    const ids = await page.js(SETUP);
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
    await page.wait(400);
    // Sign in, Home and Portfolio in view.
    await frameView(page, { x: 450, y: 0, w: 1290, h: 844, margin: 34, offsetY: -24 });
    await page.wait(400);
    const home = await nodeRect(page, ids["03 Home"]);
    await page.move(home.cx + 120, home.bottom - 40, 1);
    page.start();
    await page.wait(600);
    // The screen, by its name above it.
    await page.click(home.x + 18, home.y - 9, { ms: 800, pause: 100 });
    await page.wait(600);
    // In on Home's holdings and the panel.
    const list = await nodeRect(page, ids.Holdings);
    await Promise.all([page.zoom(840, list.cy - 10, 1.5, 900), page.move(list.cx, list.y - 20, 850)]);
    await page.anchor('[data-region="canvas"]');
    const row = await nodeRect(page, ids["Holding AAPL"]);
    await page.click(row.x + row.w * 0.5, row.y + 4, { ms: 650, pause: 100 });
    await page.wait(500);
    await page.key("Escape");
    await page.wait(500);
    await page.key("a", ["shift"]);
    await page.wait(800);
    // Scrub the gap: the rows spread out, then settle.
    await page.anchor(null);
    const sel = 'label[title="Gap between items"] > span:first-of-type';
    const g = await page.waitFor(sel);
    await page.move(g.cx, g.cy, 800);
    await page.anchor(sel);
    await page.drag(g.cx, g.cy, g.cx + 16, g.cy, 1100, undefined, 60);
    await page.mark("gap");
    await page.wait(350);
    await page.drag(g.cx + 16, g.cy, g.cx + 8, g.cy, 650, undefined, 40);
    await page.anchor(null);
    await page.wait(500);
    await Promise.all([page.unzoom(900), page.move(home.cx + 60, home.bottom + 10, 900)]);
    await page.wait(300);
    await page.key("Escape");
    await page.key("Escape");
    await page.key("1", ["shift"]);
    await page.wait(1500);
};
module.exports.opts = { duration: 14, posterMark: "gap", posterDelay: 0.3 };

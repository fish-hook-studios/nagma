// Auto layout: a frame of three cards becomes a stack (⇧A), a card grows as you type into it,
// and changing the gap reflows the stack.
const { field, closeWelcome, nodes, nodeRect, fieldRect, sizeField } = require("./_lib.cjs");

const CARDS = [
  { text: "Morning run", fill: "E8EEFF", y: 140 },
  { text: "Team standup", fill: "FFF1DC", y: 204 },
  { text: "Ship the release", fill: "E3F6EA", y: 274 },
];

async function select(a, id) {
  await a.js(`nagma.set({ selection: [${JSON.stringify(id)}] })`);
  await a.wait(120);
}

module.exports = async (a) => {
  await closeWelcome(a);
  await a.clickOn("button", "Design");
  await a.wait(2000);
  // Setup (not recorded): an outer frame with three cards, each an auto layout frame around a text.
  await a.key("f");
  await a.drag(434, 102, 760, 520);
  const outer = (await nodes(a)).find((n) => n.type === "frame").id;
  await field(a, { label: "Corner radius" }, "16");
  for (const card of CARDS) {
    await a.key("t");
    await a.click(462, card.y);
    await a.type(card.text, 5);
    await a.key("escape");
    await field(a, { label: "Font size" }, "18");
    await a.key("a", ["shift"]);
    await a.wait(200);
    await field(a, { label: "Horizontal padding" }, "18");
    await field(a, { label: "Vertical padding" }, "14");
    await field(a, { label: "Corner radius" }, "10");
    await a.clickOn('button[aria-label="Add fill"]');
    await a.wait(200);
    await field(a, { label: "Hex colour" }, card.fill);
    await sizeField(a, "W", 272);
  }
  let all = await nodes(a);
  const cards = all.filter((n) => n.type === "frame" && n.id !== outer).sort((p, q) => p.y - q.y);
  const last = cards[cards.length - 1];
  const o = all.find((n) => n.id === outer);
  await select(a, outer);
  await sizeField(a, "H", Math.round(last.y + last.h + 28 - o.y));
  await sizeField(a, "W", Math.round(cards[0].x + 272 + 28 - o.x));
  await a.js(`nagma.set({ selection: [] })`);
  all = await nodes(a);
  console.log(JSON.stringify(all.map((n) => [n.type, n.name, n.x, n.y, n.w, n.h])));
  // Frame the view: zoom 1.5 around the frame, a little left of center.
  const of = all.find((n) => n.id === outer);
  await a.js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const z = 1.5; nagma.set({ camera: { zoom: z, x: c.width / 2 - (${of.x} + ${of.w} / 2) * z, y: 120 - ${of.y} * z } }); })()`);
  await a.wait(400);
  await a.move(900, 640, 10);
  await a.shot("ready");
  if (process.env.SETUP_ONLY) return;

  // Recorded part.
  const textOf = (name) => all.find((n) => n.type === "text" && n.name === name).id;
  const label = await a.js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const s = nagma.get(); return { x: c.x + ${of.x} * s.camera.zoom + s.camera.x + 22, y: c.y + ${of.y} * s.camera.zoom + s.camera.y - 13 }; })()`);
  a.rec.start();
  await a.wait(350);
  await a.click(label.x, label.y, { ms: 550 });
  await a.wait(300);
  await a.key("A", ["shift"]);
  await a.wait(650);
  let t = await nodeRect(a, textOf("Team standup"));
  await a.move(t.right - 8, t.y, 400);
  await a.wait(150);
  await a.dblclick();
  await a.wait(120);
  await a.dblclick();
  await a.wait(250);
  await a.key("End", ["meta"]);
  await a.type("\n10:00 · Room 4", 45);
  await a.wait(300);
  await a.key("escape");
  await a.wait(150);
  await a.click(label.x, label.y, { ms: 500 });
  await a.wait(300);
  const gap = await fieldRect(a, { label: "Gap between items" });
  await a.move(gap.lx, gap.ly, 550);
  await a.wait(200);
  await a.down();
  for (let i = 1; i <= 10; i++) { a.wc.sendInputEvent({ type: "mouseMove", x: Math.round(gap.lx + i), y: Math.round(gap.ly), button: "left", modifiers: ["leftButtonDown"] }); await a.js(`window.__recCursor(${gap.lx + i}, ${gap.ly})`); await a.wait(45); }
  await a.up();
  a.pos.x = gap.lx + 10;
  await a.wait(200);
  await a.key("escape");
  await a.wait(400);
  await a.move(980, 700, 500);
  a.rec.poster();
  await a.wait(850);
  await a.rec.stop();
  await a.shot("end");
  return { name: "loop-autolayout", crf: 20 };
};

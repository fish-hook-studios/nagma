// Prototype: a list screen's button is wired to a detail screen in Prototype mode, a transition is
// picked in the interaction popover, and Present plays it.
const { field, closeWelcome, nodes, nodeRect, fieldRect, sizeField, buttons } = require("./_lib.cjs");

async function text(a, x, y, str, size, color) {
  await a.key("t");
  await a.click(x, y, { ms: 60 });
  await a.type(str, 4);
  await a.key("escape");
  if (size) await field(a, { label: "Font size" }, String(size));
  if (color) await field(a, { label: "Hex colour" }, color);
}
async function rect(a, x1, y1, x2, y2, fill, radius) {
  await a.key("r");
  await a.drag(x1, y1, x2, y2, 150);
  await field(a, { label: "Hex colour" }, fill);
  if (radius) await field(a, { label: "Corner radius" }, String(radius));
}
async function weight(a) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await a.js(`[...document.querySelectorAll('*')].filter(x => x.scrollTop > 0 && x.getBoundingClientRect().x > 1000).forEach(x => { x.scrollTop = 0; })`);
    await a.wait(100);
    const b = await a.rect('button[aria-label="Font style"]');
    await a.click(b.x, b.y, { ms: 120 });
    for (let i = 0; i < 10; i++) {
      const o = await a.rect('[role=menu] [role]', 'Semi Bold');
      if (o) { await a.wait(300); const o2 = await a.rect('[role=menu] [role]', 'Semi Bold'); console.log('weight', JSON.stringify(o2), await a.js(`document.elementFromPoint(${o2.x}, ${o2.y}).closest('[role]').textContent`)); await a.click(o2.x, o2.y, { ms: 120 }); await a.wait(150); return; }
      await a.wait(100);
    }
    console.log("weight menu not open, attempt", attempt, JSON.stringify(b), await a.js(`(() => { const e = document.elementFromPoint(${b.x}, ${b.y}); return e.tagName + ' ' + (e.closest('[aria-label]') || {}).outerHTML?.slice(0, 200) + ' scroll=' + [...document.querySelectorAll('*')].filter(x => x.scrollTop > 0).map(x => x.className.slice(0,40) + ':' + x.scrollTop).join(','); })()`));
    if (attempt === 0) await a.shot("weightfail");
  }
}

async function setup(a) {
  await closeWelcome(a);
  await a.clickOn("button", "Design");
  await a.wait(2000);
  // Screen A: the list.
  await a.key("f");
  await a.drag(340, 110, 580, 570, 200);
  await field(a, { label: "Corner radius" }, "20");
  await text(a, 362, 134, "Habits", 24);
  await weight(a);
  const rows = ["Read 20 pages", "Drink water", "Walk 8k steps"];
  for (let i = 0; i < rows.length; i++) {
    await rect(a, 360, 186 + i * 62, 560, 236 + i * 62, "F2F3F6", 12);
    await text(a, 378, 212 + i * 62, rows[i], 15);
  }
  await text(a, 420, 506, "New habit", 15, "FFFFFF");
  await weight(a);
  await a.key("A", ["shift"]);
  await a.wait(200);
  await field(a, { label: "Horizontal padding" }, "16");
  await field(a, { label: "Vertical padding" }, "13");
  await field(a, { label: "Corner radius" }, "12");
  await a.clickOn('button[aria-label="Add fill"]');
  await a.wait(150);
  await field(a, { label: "Hex colour" }, "2F6BFF");
  await sizeField(a, "W", 200);
  await sizeField(a, "X", 20);
  await a.clickOn('button[aria-label="Align top centre"]');
  // Screen B: the detail.
  await a.key("escape"); await a.key("escape");
  await a.js(`nagma.set({ selection: [] })`);
  await a.key("f");
  await a.drag(700, 110, 940, 570, 200);
  await field(a, { label: "Corner radius" }, "20");
  await text(a, 722, 134, "New habit", 24);
  await weight(a);
  await rect(a, 720, 186, 920, 232, "F2F3F6", 12);
  await text(a, 736, 209, "Meditate", 15);
  await rect(a, 720, 244, 920, 290, "F2F3F6", 12);
  await text(a, 736, 267, "Every morning", 15, "6B7280");
  await rect(a, 720, 302, 920, 400, "EAF1FF", 12);
  await text(a, 736, 318, "Streak goal", 13, "2F6BFF");
  await text(a, 736, 340, "21 days", 28);
  await weight(a);
  await a.js(`nagma.set({ selection: [] })`);
  // Name the screens: double-click a frame's name on the canvas.
  for (const [x, y, name] of [[352, 97, "Habits"], [712, 97, "New habit"]]) {
    await a.dblclick(x, y);
    await a.wait(200);
    await a.js(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
    await a.type(name, 4);
    await a.key("enter");
    await a.wait(150);
  }
  // The button's layer name.
  await a.dblclick(138, 551);
  await a.wait(200);
  await a.js(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
  await a.type("Button", 4);
  await a.key("enter");
  await a.js(`nagma.set({ selection: [] })`);
  const all = await nodes(a);
  console.log(JSON.stringify(all.map((n) => [n.id, n.type, n.name, n.x, n.y, n.w, n.h, n.parentId])));
  await a.move(1000, 650, 10);
  await a.shot("ready");
  return all;
}

module.exports = async (a) => {
  const all = await setup(a);
  if (process.env.SETUP_ONLY) return;
  const A = all.find((n) => n.type === "frame" && n.name === "Habits");
  const B = all.find((n) => n.type === "frame" && n.name === "New habit");
  const btn = all.find((n) => n.type === "frame" && n.parentId === A.id);
  // View: zoom 1.1 centered on both screens.
  await a.js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const z = 1.1; const cx = (${A.x} + ${B.x + B.w}) / 2, cy = (${A.y} + ${A.y + A.h}) / 2; nagma.set({ camera: { zoom: z, x: c.width / 2 - cx * z, y: c.height / 2 - cy * z - 20 } }); })()`);
  await a.wait(300);
  const PROBE = process.argv.includes("--probe");
  a.rec.start();
  await a.wait(300);
  const tab = await a.rect("button", "prototype");
  await a.click(tab.x, tab.y, { ms: 450 });
  await a.wait(150);
  const b = await nodeRect(a, btn.id);
  await a.click(b.left + 26, b.y + 10, { ms: 500 });
  await a.wait(150);
  const selId = JSON.parse(await a.js("JSON.stringify(nagma.get().selection[0])"));
  if (selId !== btn.id) console.log("WARNING: selected", selId, "not the button");
  const bb = await nodeRect(a, selId);
  const hx = bb.right + 12, hy = bb.y;
  await a.move(hx, hy, 350);
  await a.wait(100);
  const tgt = await nodeRect(a, B.id);
  await a.drag(hx, hy, tgt.x - 30, tgt.y + 20, 700);
  await a.wait(350);
  const anim = await a.rect('button[aria-label="Animation"]');
  await a.move(anim.x, anim.y, 400);
  await a.wait(80);
  await a.down();
  await a.wait(300);
  const push = await a.rect("[role=menu] [role]", "Push");
  await a.move(push.x - 30, push.y, 350);
  await a.wait(150);
  await a.up();
  await a.wait(550);
  // Poster: the wired connection with its Push transition.
  a.rec.poster();
  const present = await a.rect('button[aria-label="Present"]');
  await a.click(present.x, present.y, { ms: 450 });
  await a.wait(650);
  const pb = { x: 640, y: 593 };
  await a.click(pb.x, pb.y, { ms: 450 });
  await a.wait(400);
  await a.move(pb.x + 230, pb.y + 90, 400);
  await a.wait(550);
  await a.rec.stop();
  if (PROBE) await a.shot("end");
  return { name: "loop-prototype", crf: 20 };
};
module.exports.setup = setup;

// Comments and version history in a Design file: the comment tool, a pinned comment, then
// File › Show version history. (A draft on this computer has no server, so the history panel
// shows its honest empty state: version history lives on a server.)
const { nodeRect } = require("./_lib.cjs");
const { setup } = require("./loop-prototype.cjs");

module.exports = async (a) => {
  const all = await setup(a);
  const A = all.find((n) => n.type === "frame" && n.name === "Habits");
  const B = all.find((n) => n.type === "frame" && n.name === "New habit");
  await a.js(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const z = 1.1; const cx = (${A.x} + ${B.x + B.w}) / 2, cy = (${A.y} + ${A.y + A.h}) / 2; nagma.set({ camera: { zoom: z, x: c.width / 2 - cx * z, y: c.height / 2 - cy * z - 20 } }); })()`);
  await a.wait(300);
  const goal = await nodeRect(a, all.find((n) => n.type === "text" && n.name === "21 days").id);
  a.rec.start();
  await a.wait(250);
  const tool = await a.rect('button[aria-label="Comment"]');
  await a.click(tool.x, tool.y, { ms: 500 });
  await a.wait(150);
  await a.click(goal.right + 22, goal.top - 4, { ms: 550 });
  await a.wait(250);
  await a.type("Looks great, ship it", 45);
  await a.wait(150);
  const post = await a.rect("button", "Post");
  await a.click(post.x, post.y, { ms: 400 });
  await a.wait(700);
  const close = await a.rect('button[aria-label="Close"]');
  if (close) { await a.click(close.x, close.y, { ms: 400 }); await a.wait(150); }
  const mm = await a.rect('button[aria-label="Main menu"]');
  await a.click(mm.x, mm.y, { ms: 600 });
  await a.wait(250);
  const f = await a.rect("[role=menu] [role]", "File›");
  await a.move(f.x, f.y, 300);
  await a.wait(350);
  const v = await a.rect("[role=menu] [role]", "Show version history");
  await a.move(f.x + 90, f.y, 200);
  await a.click(v.x, v.y, { ms: 450 });
  await a.wait(500);
  await a.move(1150, 330, 450);
  a.rec.poster();
  await a.wait(900);
  await a.rec.stop();
  return { name: "loop-collab", crf: 20 };
};

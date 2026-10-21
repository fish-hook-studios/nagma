// Writes img/loop-make-prompt.* (img/loop-make.* is the other recorder's Make loop).
// Make: from Home, a new Make app; a prompt typed slowly into the composer. Not sent: there is no
// AI key on this device, so the app shows its key notice and the empty preview, as it really does.
const { closeWelcome } = require("./_lib.cjs");

module.exports = async (a) => {
  await closeWelcome(a);
  await a.wait(600);
  await a.move(700, 300, 10);
  a.rec.start();
  await a.wait(300);
  const make = await a.rect("button", "Make");
  await a.click(make.x, make.y, { ms: 600 });
  const box = await a.waitFor("textarea");
  await a.wait(500);
  await a.click(box.x - 60, box.y - 20, { ms: 650 });
  await a.wait(200);
  await a.type("A habit tracker with a weekly view and streaks", 72);
  await a.wait(350);
  const send = await a.rect('button[aria-label="Send"]');
  await a.move(send.x - 2, send.y - 3, 600);
  a.rec.poster();
  await a.wait(1000);
  await a.rec.stop();
  return { name: "loop-make-prompt", crf: 20 };
};

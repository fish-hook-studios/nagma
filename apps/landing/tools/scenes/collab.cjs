// Comments and version history: the Premalu 2 screens (scenes/_app.cjs). The comment tool, a pin on
// the detail screen's notes, zoomed in while "Looks great, ship it" is typed and posted; then
// Main menu › File › Show version history. (A draft on this computer has no server, so the history
// panel shows its honest state: version history lives on a server.)
const { buildApp, frameView, nodeRect, patchRects, rawRect } = require("./_app.cjs");

module.exports = async function collab(page) {
    const ids = await buildApp(page);
    await frameView(page, { x: 0, y: 0, w: 840, h: 844, margin: 70, offsetY: -30 });
    await page.wait(400);
    await page.move(950, 650, 1);
    page.start();
    await page.wait(600);
    await page.clickEl('button[aria-label="Comment"]', { ms: 750, pause: 80 });
    await page.wait(500);
    const notes = await nodeRect(page, ids["Notes card"]);
    await page.click(notes.right - 40, notes.y + 20, { ms: 800, pause: 100 });
    await page.wait(400);
    // In on the composer while the comment is typed and posted.
    await patchRects(page, true);
    await Promise.all([page.zoom(notes.x + 70, notes.y + 50, 1.55, 800), page.move(notes.x + 120, notes.y + 110, 700)]);
    await page.type("Looks great, ship it", 55);
    await page.wait(500);
    await page.key("Enter");
    await page.wait(250);
    await page.mark("posted");
    await page.wait(900);
    await Promise.all([page.unzoom(850), page.move(700, 500, 850)]);
    await patchRects(page, false);
    await page.key("Escape");
    await page.wait(500);
    // Main menu › File › Show version history.
    const mm = await page.waitFor('button[aria-label="Main menu"]');
    await page.click(mm.cx, mm.cy, { ms: 800, pause: 80 });
    await page.wait(450);
    const file = await page.waitFor("text=File");
    await page.move(file.cx, file.cy, 500);
    await page.wait(450);
    const vh = await page.waitFor("text=Show version history");
    await page.move(file.cx + 90, file.cy, 300);
    await page.click(vh.cx, vh.cy, { ms: 550, pause: 80 });
    await page.wait(600);
    await page.move(1150, 380, 650);
    await page.wait(1000);
};
module.exports.opts = { duration: 14, posterMark: "posted", posterDelay: 0.6 };

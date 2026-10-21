// Auto layout: the Premalu 2 Today screen (scenes/_app.cjs). A card is clicked and Esc climbs to the
// agenda list; zoomed in on the list and the Auto layout panel, ⇧A turns it into a stack, a second
// line typed into a card grows the card and the list, and the gap is scrubbed so the cards reflow.
const { buildApp, frameView, nodeRect } = require("./_app.cjs");

module.exports = async function autolayout(page) {
    const ids = await buildApp(page, { detail: false });
    await frameView(page, { x: -260, y: 0, w: 910, h: 844, margin: 24, offsetY: -24 });
    await page.wait(400);
    const card1 = await nodeRect(page, ids["Card 1"]);
    await page.move(card1.cx + 60, card1.bottom + 160, 1);
    page.start();
    await page.wait(700);
    // Card 1's top padding (the card itself), then Esc up to the list.
    await page.click(card1.x + 150, card1.y + 7, { ms: 800, pause: 120 });
    await page.wait(550);
    await page.key("Escape");
    await page.wait(500);
    const list = await nodeRect(page, ids.Agenda);
    await Promise.all([page.zoom(860, list.cy + 20, 1.35, 850), page.move(list.cx + 40, list.bottom + 30, 800)]);
    await page.wait(300);
    await page.key("a", ["shift"]);
    await page.wait(800);
    // A second line in Card 2's secondary text: the card and the list grow.
    const sub = await nodeRect(page, ids["Card 2 subtitle"]);
    await page.anchor('[data-region="canvas"]');
    await page.move(sub.x + sub.w * 0.6, sub.cy, 750);
    await page.click(undefined, undefined, { count: 2, pause: 60 });
    await page.wait(200);
    await page.key("End", ["meta"]);
    await page.type("\nAll hands at 1:00", 55);
    await page.wait(500);
    for (let i = 0; i < 4; i++) {
        await page.key("Escape");
        await page.wait(90);
    }
    await page.wait(250);
    // Scrub the gap: the cards spread out, then settle.
    const sel = 'label[title="Gap between items"] > span:first-of-type';
    const g = await page.waitFor(sel);
    await page.anchor(null);
    await page.move(g.cx, g.cy, 800);
    await page.anchor(sel);
    await page.drag(g.cx, g.cy, g.cx + 16, g.cy, 1100, undefined, 60);
    await page.mark("gap");
    await page.wait(350);
    await page.drag(g.cx + 16, g.cy, g.cx + 8, g.cy, 650, undefined, 40);
    await page.anchor(null);
    await page.wait(300);
    await Promise.all([page.unzoom(900), page.move(list.cx + 220, list.bottom + 140, 900)]);
    await page.wait(800);
};
module.exports.opts = { duration: 14, posterMark: "gap", posterDelay: 0.3 };

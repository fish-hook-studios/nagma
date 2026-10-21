// Campaign: Home › More › Campaign, the Headline template, Resize to… four more sizes, the grid of
// sizes, then Bulk edit: a new headline, filled down to every size, and back to the grid.
module.exports = async function campaignScene(page) {
    page.start();
    await page.wait(200);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Campaign", { ms: 300, pause: 40 });
    const card = await page.waitFor("text=Headline");
    await page.wait(200);
    await page.click(card.cx, card.cy - 50, { ms: 400, pause: 40 });
    await page.waitFor("label=Template");
    await page.wait(200);
    await page.clickEl("label=Template", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Resize to…", { ms: 300, pause: 40 });
    await page.wait(200);
    for (const t of ["Story", "Landscape", "Header banner", "Medium rectangle"]) await page.clickEl(`text=${t}`, { ms: 200, pause: 25 });
    await page.clickEl("text=Create 4 copies", { ms: 350, pause: 40 });
    await page.wait(200);
    await page.clickEl("label=Grid view", { ms: 400, pause: 40 });
    await page.wait(450);
    await page.clickEl("label=Bulk edit", { ms: 400, pause: 40 });
    await page.waitFor("text=Asset size");
    await page.wait(150);
    await page.click(300, 187, { ms: 350, pause: 40 });
    await page.type("Autumn deals are here", 22);
    await page.key("Enter");
    // Enter moves down a row; back to the new headline, then drag its fill handle down.
    await page.click(300, 187, { ms: 200, pause: 30 });
    await page.drag(351, 207, 351, 352, 500, undefined, 250);
    await page.wait(250);
    await page.clickEl("label=Grid view", { ms: 450, pause: 40 });
    await page.mark("grid");
    await page.move(700, 640, 400);
    await page.wait(900);
};
module.exports.opts = { duration: 9, fade: 0.5, posterMark: "grid", posterDelay: 0.6, maxSpeed: 1.45 };

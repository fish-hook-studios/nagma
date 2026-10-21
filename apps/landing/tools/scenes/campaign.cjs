// Campaign: Home › More › Campaign, the Headline template; Resize to… (zoomed in on the dialog)
// four more sizes; Bulk edit (zoomed in on the table): a new headline, filled down to every size;
// then the grid of sizes, all updated.
module.exports = async function campaignScene(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(120);
    await page.clickEl("text=Campaign", { ms: 300, pause: 40 });
    const card = await page.waitFor("text=Headline");
    await page.wait(150);
    await page.click(card.cx, card.cy - 50, { ms: 400, pause: 40 });
    await page.waitFor("label=Template");
    await page.wait(100);
    await page.clickEl("label=Template", { ms: 400, pause: 40 });
    await page.wait(120);
    await page.clickEl("text=Resize to…", { ms: 300, pause: 40 });
    const story = await page.waitFor("text=Story");
    await Promise.all([page.zoom(600, 395, 1.5, 750), page.move(story.cx, story.cy, 700)]);
    for (const t of ["Story", "Landscape", "Header banner", "Medium rectangle"]) await page.clickEl(`text=${t}`, { ms: 330, pause: 40 });
    await page.wait(200);
    const create = await page.rect("text=Create 4 copies");
    await Promise.all([page.unzoom(700), page.move(create.cx, create.cy, 700)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.wait(200);
    await page.clickEl("label=Bulk edit", { ms: 450, pause: 40 });
    await page.waitFor("text=Asset size");
    await Promise.all([page.zoom(330, 260, 1.6, 750), page.move(300, 187, 700)]);
    await page.click(300, 187, { ms: 100, pause: 40 });
    await page.type("Autumn deals are here", 34);
    await page.key("Enter");
    // Enter moves down a row; back to the new headline, then drag its fill handle down.
    await page.click(300, 187, { ms: 250, pause: 30 });
    await page.drag(351, 207, 351, 352, 650, undefined, 250);
    await page.wait(300);
    const grid = await page.rect("label=Grid view");
    await Promise.all([page.unzoom(750), page.move(grid.cx, grid.cy, 750)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.mark("grid");
    await page.move(700, 640, 450);
    await page.wait(900);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "grid", posterDelay: 0.6 };

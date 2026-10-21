// Slides: Home › Slides; zoomed in on the template picker that opens on a new deck, Ocean;
// Add all slides; zoomed in on the filmstrip, three slides clicked through; then Present.
module.exports = async function slidesScene(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=Slides", { ms: 450, pause: 40 });
    const card = await page.waitFor("text=Ocean");
    await page.wait(100);
    await Promise.all([page.zoom(card.cx, card.cy - 40, 1.5, 750), page.move(card.cx - 60, card.cy - 120, 700)]);
    await page.wait(200);
    await page.click(card.cx, card.cy - 60, { ms: 450, pause: 50 });
    await page.wait(350);
    const add = await page.waitFor("text=Add all slides");
    await Promise.all([page.unzoom(700), page.move(add.cx, add.cy, 700)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.wait(250);
    // The filmstrip jumps to the last slide added; back to the top.
    await page.move(130, 420, 300);
    for (let i = 0; i < 6; i++) {
        await page.scroll(130, 420, -400);
        await page.wait(20);
    }
    // Down one slide, so slides 3 to 5 sit beside the slide view.
    await page.scroll(130, 420, 122);
    await page.wait(150);
    await Promise.all([page.zoom(130, 390, 1.45, 750), page.move(130, 330, 700)]);
    for (const y of [365, 487, 609]) {
        await page.click(130, y, { ms: 380, pause: 40 });
        await page.wait(450);
    }
    await page.mark("columns");
    const present = await page.rect("label=Present");
    await Promise.all([page.unzoom(750), page.move(present.cx, present.cy, 750)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.wait(900);
    await page.click(900, 520, { ms: 300, pause: 30 });
    await page.wait(900);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "columns", posterDelay: -0.3 };

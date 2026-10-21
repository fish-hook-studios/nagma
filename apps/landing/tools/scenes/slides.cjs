// Slides: Home › Slides, the template picker that opens on a new deck, Ocean › Add all slides,
// click through three slides in the filmstrip, then Present.
module.exports = async function slidesScene(page) {
    page.start();
    await page.wait(250);
    await page.clickEl("text=Slides", { ms: 450, pause: 50 });
    const card = await page.waitFor("text=Ocean");
    await page.wait(250);
    await page.click(card.cx, card.cy - 60, { ms: 500, pause: 60 });
    await page.wait(300);
    await page.clickEl("text=Add all slides", { ms: 450, pause: 60 });
    await page.wait(300);
    // The filmstrip jumps to the last slide added; back to the top.
    await page.move(130, 420, 300);
    for (let i = 0; i < 6; i++) {
        await page.scroll(130, 420, -400);
        await page.wait(20);
    }
    await page.wait(250);
    for (const y of [487, 609, 731]) {
        await page.click(130, y, { ms: 350, pause: 40 });
        await page.wait(400);
    }
    await page.mark("columns");
    await page.clickEl("label=Present", { ms: 550, pause: 60 }).catch(() => page.click(1193, 62, { ms: 550 }));
    await page.wait(900);
    await page.click(900, 520, { ms: 300, pause: 30 });
    await page.wait(950);
};
module.exports.opts = { duration: 9, fade: 0.5, posterMark: "columns", posterDelay: -0.2, maxSpeed: 1.4 };

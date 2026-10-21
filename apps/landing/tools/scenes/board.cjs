// Board: Home › Board, S and type a sticky, three more in other colours, a section around them,
// then drag one sticky.
module.exports = async function boardScene(page) {
    page.start();
    await page.wait(250);
    await page.clickEl("text=Board", { ms: 450, pause: 50 });
    await page.waitFor("label=Zoom out");
    await page.wait(150);
    await page.clickEl("label=Zoom out", { ms: 400, pause: 40 });
    await page.wait(120);
    const notes = [
        [null, 560, 300, "Ship the beta"],
        ["Green", 700, 300, "Talk to 5 users"],
        ["Blue", 560, 440, "Pricing page"],
        ["Violet", 700, 440, "Launch post"],
    ];
    for (const [color, x, y, text] of notes) {
        await page.key("s");
        await page.wait(80);
        if (color) await page.clickEl(`[aria-label="Sticky notes"] [aria-label="${color}"]`, { ms: 300, pause: 40 });
        await page.click(x, y, { ms: 300, pause: 40 });
        await page.wait(100);
        await page.type(text, 24);
        await page.key("Escape");
    }
    await page.key("Escape");
    await page.key("s", ["shift"]);
    await page.drag(465, 205, 960, 545, 600, undefined, 300);
    await page.mark("section");
    await page.wait(250);
    await page.key("Escape");
    // Drag the last sticky to the free side of the section.
    await page.drag(700, 470, 860, 410, 600, undefined, 350);
    await page.wait(200);
    await page.move(1060, 650, 350);
    await page.wait(700);
};
module.exports.opts = { duration: 10, fade: 0.5, posterMark: "section", posterDelay: 0.3 };

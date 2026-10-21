// Board: Home › Board; S and a sticky typed (zoomed in on it), three more in other colours, a
// section around them, then (zoomed in) one sticky dragged across the section.
module.exports = async function boardScene(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=Board", { ms: 450, pause: 40 });
    await page.waitFor("label=Zoom out");
    await page.wait(100);
    await page.clickEl("label=Zoom out", { ms: 400, pause: 40 });
    await page.wait(100);
    const notes = [
        [null, 560, 300, "Ship the beta"],
        ["Green", 700, 300, "Talk to 5 users"],
        ["Blue", 560, 440, "Pricing page"],
        ["Violet", 700, 440, "Launch post"],
    ];
    let first = true;
    for (const [color, x, y, text] of notes) {
        await page.key("s");
        await page.wait(80);
        if (color) await page.clickEl(`[aria-label="Sticky notes"] [aria-label="${color}"]`, { ms: 300, pause: 40 });
        await page.click(x, y, { ms: 300, pause: 40 });
        if (first) {
            // In on the first sticky while it's typed.
            await page.zoom(x, y, 1.8, 700, { wait: false });
            await page.wait(350);
            await page.type(text, 55);
            await page.wait(250);
            await page.key("Escape");
            await Promise.all([page.unzoom(700), page.move(640, 560, 650)]);
            first = false;
        } else {
            await page.wait(80);
            await page.type(text, 22);
            await page.key("Escape");
        }
    }
    await page.key("Escape");
    await page.key("s", ["shift"]);
    await page.drag(465, 205, 960, 545, 600, undefined, 300);
    await page.mark("section");
    await page.wait(200);
    await page.key("Escape");
    // In on the section; drag the last sticky to its free side.
    await page.anchor('[data-region="canvas"]');
    await Promise.all([page.zoom(760, 400, 1.45, 750), page.move(700, 470, 700)]);
    await page.drag(700, 470, 860, 410, 700, undefined, 50);
    await page.wait(250);
    await page.anchor(null);
    await Promise.all([page.unzoom(750), page.move(1060, 650, 700)]);
    await page.wait(600);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "section", posterDelay: 0.3 };

// Document: Home › More › Document (a blank three-page PDF; the app ships no sample PDF), a text
// box, a drawn signature placed on the page, then Organize pages (the page sorter).
module.exports = async function documentScene(page) {
    // Recording starts on the New document dialog (Home › More › Document), to fit the loop.
    await page.clickEl("text=More", { ms: 1, pause: 40 });
    await page.wait(250);
    await page.clickEl("text=Document", { ms: 1, pause: 40 });
    await page.wait(500);
    page.start();
    await page.wait(150);
    const pages = await page.waitFor('input[aria-label="Number of pages"]').catch(() => null);
    await page.wait(200);
    if (pages) {
        await page.click(pages.cx, pages.cy, { ms: 400, pause: 30, count: 3 });
        await page.type("3", 40);
    }
    await page.clickEl("text=Create", { ms: 350, pause: 40 });
    await page.waitFor("label=Text box");
    await page.wait(300);
    await page.clickEl("label=Text box", { ms: 400, pause: 30 });
    await page.click(380, 240, { ms: 350, pause: 30 });
    await page.wait(150);
    await page.type("Service agreement", 28);
    await page.clickEl("label=Select", { ms: 400, pause: 30 });
    await page.clickEl("label=Sign", { ms: 450, pause: 40 });
    const pad = await page.waitFor("text=Add a signature");
    await page.wait(150);
    // A quick looping signature in the Draw box.
    const x0 = pad.x + 60;
    const y0 = pad.y + 165;
    const pts = [];
    for (let i = 0; i <= 70; i++) {
        const t = i / 70;
        pts.push([x0 + t * 280 - 16 * Math.sin(t * Math.PI * 10), y0 - 26 * Math.cos(t * Math.PI * 10) * (1 - 0.5 * t) - 10 * Math.sin(t * Math.PI)]);
    }
    await page.move(pts[0][0], pts[0][1], 350);
    await page.down();
    for (const [x, y] of pts) await page.move(x, y, 9);
    await page.up();
    await page.wait(150);
    await page.clickEl("text=Place", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.click(720, 560, { ms: 450, pause: 40 });
    await page.mark("signed");
    await page.wait(350);
    await page.clickEl("label=Organize pages", { ms: 500, pause: 40 });
    await page.wait(250);
    await page.move(560, 520, 450);
    await page.wait(900);
};
module.exports.opts = { duration: 8, fade: 0.5, posterMark: "signed", posterDelay: 0.2, maxSpeed: 1.45 };

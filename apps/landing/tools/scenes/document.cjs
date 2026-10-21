// Document: Home › More › Document (a blank three-page PDF; the app ships no sample PDF); a text
// box typed (zoomed in); a signature drawn (zoomed in on the Sign dialog) and placed on the page;
// then Organize pages (the page sorter).
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
    await page.zoom(470, 250, 1.7, 700, { wait: false });
    await page.wait(250);
    await page.type("Service agreement", 45);
    await page.wait(200);
    const select = await page.rect("label=Select");
    await Promise.all([page.unzoom(700), page.move(select.cx, select.cy, 650)]);
    await page.click(undefined, undefined, { pause: 30 });
    await page.clickEl("label=Sign", { ms: 450, pause: 40 });
    const pad = await page.waitFor("text=Add a signature");
    // A quick looping signature in the Draw box.
    const x0 = pad.x + 60;
    const y0 = pad.y + 165;
    const pts = [];
    for (let i = 0; i <= 70; i++) {
        const t = i / 70;
        pts.push([x0 + t * 280 - 16 * Math.sin(t * Math.PI * 10), y0 - 26 * Math.cos(t * Math.PI * 10) * (1 - 0.5 * t) - 10 * Math.sin(t * Math.PI)]);
    }
    await Promise.all([page.zoom(627, 300, 1.6, 750), page.move(pts[0][0], pts[0][1], 700)]);
    await page.anchor('[role="dialog"] canvas');
    await page.down();
    for (const [x, y] of pts) await page.move(x, y, 11);
    await page.up();
    await page.anchor(null);
    await page.wait(150);
    await page.clickEl("text=Place", { ms: 400, pause: 40 });
    await Promise.all([page.unzoom(750), page.move(720, 560, 700)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.mark("signed");
    await page.wait(350);
    await page.clickEl("label=Organize pages", { ms: 500, pause: 40 });
    await page.wait(250);
    await page.move(560, 520, 450);
    await page.wait(900);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "signed", posterDelay: 0.2 };

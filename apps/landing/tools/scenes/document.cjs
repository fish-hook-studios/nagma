// Document: ?new=document, a blank three-page PDF made before recording (the app ships no sample
// PDF); a text
// box typed (zoomed in); the signature "Sonu" handwritten (zoomed in on the Sign dialog) and placed on the page;
// then Organize pages (the page sorter).
const { sonu, writeSonu } = require("./_sonu.cjs");
const { openNew } = require("./_app.cjs");
module.exports = async function documentScene(page) {
    // Straight into the New document dialog (?new=document).
    await openNew(page, "document", 'input[aria-label="Number of pages"]');
    // Setup: a blank three-page PDF.
    const pages = await page.rect('input[aria-label="Number of pages"]');
    await page.click(pages.cx, pages.cy, { ms: 1, pause: 40, count: 3 });
    await page.type("3", 10);
    await page.clickEl("text=Create", { ms: 1, pause: 40 });
    await page.waitFor("label=Text box");
    await page.move(820, 520, 1);
    await page.wait(900);
    page.start();
    await page.wait(700);
    await page.clickEl("label=Text box", { ms: 650, pause: 60 });
    await page.click(380, 240, { ms: 600, pause: 60 });
    await page.zoom(470, 250, 1.7, 750, { wait: false });
    await page.wait(400);
    await page.type("Service agreement", 55);
    await page.wait(400);
    const select = await page.rect("label=Select");
    await Promise.all([page.unzoom(750), page.move(select.cx, select.cy, 750)]);
    await page.click(undefined, undefined, { pause: 50 });
    await page.wait(200);
    await page.clickEl("label=Sign", { ms: 600, pause: 60 });
    await page.waitFor("text=Add a signature");
    // "Sonu", handwritten in the Draw box (scenes/_sonu.cjs).
    const cv = await page.waitFor('[role="dialog"] canvas');
    const first = sonu(cv.x, cv.y, { w: cv.w })[0][0].pts[0];
    await Promise.all([page.zoom(627, 300, 1.6, 800), page.move(first[0], first[1], 800)]);
    await page.anchor('[role="dialog"] canvas');
    await writeSonu(page, cv);
    await page.anchor(null);
    await page.wait(400);
    await page.clickEl("text=Place", { ms: 550, pause: 60 });
    await Promise.all([page.unzoom(800), page.move(720, 560, 800)]);
    await page.click(undefined, undefined, { pause: 60 });
    await page.mark("signed");
    await page.wait(600);
    await page.clickEl("label=Organize pages", { ms: 700, pause: 60 });
    await page.wait(300);
    await page.move(560, 520, 650);
    await page.wait(1000);
};
module.exports.opts = { duration: 14, posterMark: "signed", posterDelay: 0.2 };

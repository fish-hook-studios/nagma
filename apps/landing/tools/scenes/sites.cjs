// Sites: Home › More › Site, Use a template › Product launch, Preview, drag the preview's width
// handle narrower so the page reflows to its tablet and mobile layouts, then the Publish panel.
module.exports = async function sitesScene(page) {
    page.start();
    await page.wait(200);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Site", { ms: 300, pause: 40 });
    await page.waitFor("text=Use a template");
    await page.wait(200);
    await page.clickEl("text=Use a template", { ms: 400, pause: 40 });
    await page.wait(200);
    await page.clickEl("text=Product launch", { ms: 450, pause: 40 });
    await page.wait(500);
    await page.clickEl("label=Preview", { ms: 500, pause: 40 });
    await page.waitFor("label=Close preview");
    await page.wait(700);
    const handle = () => page.js(`(() => { const h = [...document.querySelectorAll('.cursor-ew-resize')].pop(); if (!h) return { x: 1026, y: 440 }; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    // Narrower in two pulls (the preview re-fits its zoom as it narrows, so the handle moves).
    let h = await handle();
    await page.drag(h.x, h.y, h.x - 120, h.y, 700, undefined, 450);
    await page.wait(200);
    h = await handle();
    await page.drag(h.x, h.y, 860, h.y, 650, undefined, 200);
    await page.mark("narrow");
    await page.wait(700);
    await page.clickEl("label=Close preview", { ms: 450, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Publish…", { ms: 500, pause: 40 });
    await page.waitFor("text=Publish site");
    await page.move(560, 420, 400);
    await page.wait(900);
};
module.exports.opts = { duration: 9, fade: 0.5, posterMark: "narrow", posterDelay: 0.3, maxSpeed: 1.4 };

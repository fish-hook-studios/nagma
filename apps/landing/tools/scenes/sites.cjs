// Sites: Home › More › Site, Use a template › Product launch, Preview; zoomed in on the preview's
// width handle, dragged narrower so the page reflows to its tablet and mobile layouts; then
// zoomed in on the Publish panel.
module.exports = async function sitesScene(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(120);
    await page.clickEl("text=Site", { ms: 300, pause: 40 });
    await page.waitFor("text=Use a template");
    await page.wait(120);
    await page.clickEl("text=Use a template", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Product launch", { ms: 450, pause: 40 });
    await page.wait(400);
    await page.clickEl("label=Preview", { ms: 500, pause: 40 });
    await page.waitFor("label=Close preview");
    // Until the built page shows in the preview frame.
    for (let i = 0; i < 40 && !(await page.js(`!!document.querySelector('iframe[title="Site preview"]')`)); i++) await page.wait(100);
    await page.wait(400);
    const handle = async () => (await page.all(".cursor-ew-resize")).pop() || { cx: 1026, cy: 440 };
    let h = await handle();
    // In on the right half of the preview and its handle; the drag keeps the pointer on the handle.
    await Promise.all([page.zoom(690, 420, 1.5, 800), page.move(h.cx, h.cy, 750)]);
    await page.anchor({ x: h.cx, y: h.cy });
    // Narrower in two pulls (the preview re-fits its scale as it narrows, so the handle moves).
    await page.drag(h.cx, h.cy, h.cx - 120, h.cy, 750, undefined, 100);
    await page.wait(200);
    h = await handle();
    await page.anchor({ x: h.cx, y: h.cy });
    await page.drag(h.cx, h.cy, 860, h.cy, 700, undefined, 200);
    await page.mark("narrow");
    await page.wait(500);
    await page.anchor(null);
    const close = await page.rect("label=Close preview");
    await Promise.all([page.unzoom(750), page.move(close.cx, close.cy, 750)]);
    await page.click(undefined, undefined, { pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Publish…", { ms: 500, pause: 40 });
    await page.waitFor("text=Publish site");
    await Promise.all([page.zoom(490, 190, 1.6, 800), page.move(520, 300, 800)]);
    await page.wait(700);
    await Promise.all([page.unzoom(750), page.move(640, 520, 700)]);
    await page.wait(500);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "narrow", posterDelay: 0.3 };

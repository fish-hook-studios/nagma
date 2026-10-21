// Design: Home › Design, draw a frame, two rectangles, then (zoomed in on the frame and the
// Auto layout panel) ⇧A, Wrap, and the frame's edge dragged narrower so the rectangles reflow;
// back out, zoom to fit.
module.exports = async function design(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=Design", { ms: 450, pause: 40 });
    await page.waitFor("text=Layers");
    await page.wait(100);
    await page.key("f");
    await page.drag(420, 170, 860, 470, 600, undefined, 400);
    await page.key("r");
    await page.drag(500, 260, 620, 380, 380, undefined, 250);
    await page.key("r");
    await page.drag(660, 260, 780, 380, 380, undefined, 250);
    await page.click(442, 157, { ms: 400, pause: 60 });
    // In on the frame's right half and the Auto layout panel.
    await page.zoom(1100, 400, 1.45, 800, { wait: false });
    await page.move(860, 330, 700);
    await page.wait(150);
    await page.key("a", ["shift"]);
    await page.wait(400);
    await page.clickEl("label=Wrap", { ms: 500, pause: 40 });
    await page.wait(100);
    // The frame's right edge: narrower so the second rectangle wraps, then back.
    await page.anchor('[data-region="canvas"]');
    await page.drag(860, 330, 690, 330, 900, undefined, 500);
    await page.mark("narrow");
    await page.wait(400);
    await page.drag(690, 330, 880, 330, 600, undefined, 80);
    await page.anchor(null);
    await Promise.all([page.unzoom(800), page.move(980, 620, 700)]);
    await page.key("1", ["shift"]);
    await page.wait(850);
};
module.exports.opts = { duration: 10, fade: 0.5, posterMark: "narrow", posterDelay: 0.3 };

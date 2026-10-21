// Design: Home › Design, draw a frame, two rectangles, auto layout (⇧A), wrap, resize so the
// rectangles reflow, zoom to fit.
module.exports = async function design(page) {
    page.start();
    await page.wait(300);
    await page.clickEl("text=Design", { ms: 500 });
    await page.waitFor("text=Layers");
    await page.wait(250);
    await page.key("f");
    await page.drag(420, 170, 860, 470, 600, undefined, 400);
    await page.key("r");
    await page.drag(500, 260, 620, 380, 380, undefined, 250);
    await page.key("r");
    await page.drag(660, 260, 780, 380, 380, undefined, 250);
    await page.wait(100);
    await page.click(442, 157, { ms: 400, pause: 60 });
    await page.wait(150);
    await page.key("a", ["shift"]);
    await page.wait(450);
    await page.clickEl("label=Wrap", { ms: 500, pause: 60 });
    await page.wait(250);
    // The frame's right edge, narrower so the second rectangle wraps, then back.
    await page.drag(860, 330, 690, 330, 850, undefined, 450);
    await page.mark("narrow");
    await page.wait(450);
    await page.drag(690, 330, 900, 330, 650, undefined, 200);
    await page.wait(200);
    await page.move(980, 620, 350);
    await page.key("1", ["shift"]);
    await page.mark("fit");
    await page.wait(1100);
};
module.exports.opts = { duration: 10, fade: 0.5, posterMark: "narrow", posterDelay: 0.3 };

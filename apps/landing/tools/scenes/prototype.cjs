// Prototype: the Premalu 2 Today and Design review screens (scenes/_app.cjs). Starts in the Prototype
// tab with the primary button selected; its connection dragged to the detail screen; zoomed in on the
// Interaction popover while Push is picked; then Present, and a click on the button plays the push.
const { buildApp, frameView, nodeRect, patchRects, rawRect } = require("./_app.cjs");

module.exports = async function prototype(page) {
    const ids = await buildApp(page);
    await frameView(page, { x: 0, y: 0, w: 840, h: 844, margin: 70, offsetY: -30 });
    await page.wait(400);
    // Setup: the Prototype tab, the button selected.
    await page.clickEl("text=Prototype", { ms: 1, pause: 40 });
    await page.wait(300);
    const b = await nodeRect(page, ids["Primary button"]);
    await page.click(b.x + 16, b.cy, { ms: 1, pause: 40 });
    await page.move(b.cx + 40, b.bottom + 90, 1);
    await page.wait(500);
    page.start();
    await page.wait(700);
    // The connection node on the button's right edge, dragged onto the detail screen.
    const t = await nodeRect(page, ids["Design review"]);
    await page.move(b.right + 9, b.cy, 550);
    await page.wait(200);
    await page.drag(b.right + 9, b.cy, t.x + 70, t.y + 190, 1000, undefined, 60);
    await page.wait(450);
    // In on the popover: Animation › Push.
    const anim = await page.waitFor('button[aria-label="Animation"]');
    await patchRects(page, true);
    await Promise.all([page.zoom(anim.cx, anim.cy - 60, 1.55, 800), page.move(anim.cx - 20, anim.cy - 20, 700)]);
    // Pointer presses check the pointer against rects (patched while zoomed), so the menu is
    // driven from the keyboard while the pointer moves over it as a click would.
    await page.move(anim.cx + 10, anim.cy + 2, 400);
    await page.wait(80);
    await page.js(`document.querySelector('button[aria-label="Animation"]').focus()`);
    await page.key("Enter");
    await page.wait(350);
    let push = null;
    for (let i = 0; i < 30 && !push; i++) { push = await rawRect(page, "text=Push"); if (!push) await page.wait(100); }
    await page.move(push.cx - 10, push.cy, 600);
    await page.wait(350);
    await page.key("Enter");
    await page.wait(300);
    await page.mark("push");
    await page.wait(700);
    await Promise.all([page.unzoom(850), page.move(1000, 300, 850)]);
    await patchRects(page, false);
    // Present, then the button plays the push into the detail screen.
    const present = await page.waitFor('button[aria-label="Present"]');
    await page.click(present.cx, present.cy, { ms: 650, pause: 80 });
    await page.wait(1000);
    // The presented screen sits centred in the window; its primary button near the bottom.
    const pb = { cx: 640, cy: 666 };
    await page.click(pb.cx, pb.cy, { ms: 800, pause: 120 });
    await page.wait(500);
    await page.move(pb.cx + 210, pb.cy + 50, 700);
    await page.wait(1000);
};
module.exports.opts = { duration: 14, posterMark: "push", posterDelay: 0.7 };

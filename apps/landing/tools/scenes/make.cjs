// Make: Home › Make, the composer and the empty preview; a prompt typed slowly, not sent (there
// is no AI key here, and the app says so).
module.exports = async function makeScene(page) {
    page.start();
    await page.wait(300);
    await page.clickEl("text=Make", { ms: 500, pause: 50 });
    const box = await page.waitFor('textarea[aria-label="Prompt"]');
    await page.wait(500);
    await page.click(box.x + 120, box.y + 30, { ms: 600, pause: 60 });
    await page.wait(200);
    await page.move(box.x + 250, box.y + 70, 400);
    await page.type("A habit tracker with a weekly streak chart, dark mode and a big friendly check-in button", 52);
    await page.mark("typed");
    await page.wait(400);
    // Toward Send, without sending.
    await page.move(box.x + box.w - 40, box.y + box.h + 6, 600);
    await page.wait(900);
};
module.exports.opts = { duration: 8, fade: 0.5, posterMark: "typed", posterDelay: 0.2, maxSpeed: 1.3 };

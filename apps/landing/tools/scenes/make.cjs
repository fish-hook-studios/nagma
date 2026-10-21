// Make: Home › Make; zoomed in on the composer, a prompt typed and sent; zoomed in on the chat
// while it plans and writes the files; back out as the preview renders the app.
// Needs the web app's dev server started with VITE_MAKE_DEMO=1 (a staged answer, no AI key).
module.exports = async function makeScene(page) {
    page.start();
    await page.wait(200);
    await page.clickEl("text=Make", { ms: 450, pause: 40 });
    const box = await page.waitFor('textarea[aria-label="Prompt"]');
    await page.wait(150);
    await page.zoom(box.cx, box.cy, 1.6, 750, { wait: false });
    await page.click(box.x + 120, box.y + 30, { ms: 700, pause: 40 });
    await page.type("A habit tracker with a weekly view and streaks", 38);
    await page.wait(150);
    await page.key("Enter");
    await page.unzoom(700);
    // The chat: Thinking, Planning the layout, Writing index.html, src/main.tsx…
    await page.zoom(184, 190, 1.7, 800, { wait: false });
    await page.move(250, 300, 700);
    await page.waitFor("text=4 files changed", 15000);
    await page.mark("built");
    await page.wait(250);
    await Promise.all([page.unzoom(850), page.move(820, 640, 800)]);
    await page.wait(1300);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "built", posterDelay: 1.6 };

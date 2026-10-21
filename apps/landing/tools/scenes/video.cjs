// Video: Home › More › Video, a colour matte and a title on the timeline, the title's text, then
// the playhead scrubbed so the title rises in.
module.exports = async function videoScene(page) {
    page.start();
    await page.wait(200);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(150);
    await page.clickEl("text=Video", { ms: 300, pause: 40 });
    await page.waitFor("label=New title");
    await page.wait(300);
    await page.clickEl("label=New color matte", { ms: 450, pause: 40 });
    await page.wait(200);
    await page.clickEl("label=New title", { ms: 300, pause: 40 });
    await page.wait(300);
    const text = await page.waitFor("textarea");
    await page.click(text.x + 60, text.y + 14, { ms: 550, pause: 40, count: 3 });
    await page.type("Summer in Lisbon", 45);
    await page.key("Tab");
    await page.wait(250);
    // Scrub: the ruler above the tracks.
    const ruler = await page.js(`(() => { const t = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent.trim() === "0:00"); const r = t.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 }; })()`);
    await page.drag(ruler.x + 3, ruler.y, ruler.x + 170, ruler.y, 1150, undefined, 500);
    await page.mark("title");
    await page.wait(200);
    await page.drag(ruler.x + 170, ruler.y, ruler.x + 40, ruler.y, 900, undefined, 50);
    await page.wait(150);
    await page.drag(ruler.x + 40, ruler.y, ruler.x + 230, ruler.y, 750, undefined, 50);
    await page.wait(600);
};
module.exports.opts = { duration: 8, fade: 0.5, posterMark: "title", posterDelay: 0.1, maxSpeed: 1.4 };

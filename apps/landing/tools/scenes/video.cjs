// Video: Home › More › Video, a colour matte and a title on the timeline; zoomed in on the title's
// text field while it's typed; zoomed in on the monitor and ruler while the playhead is scrubbed
// so the title rises in.
module.exports = async function videoScene(page) {
    page.start();
    await page.wait(150);
    await page.clickEl("text=More", { ms: 400, pause: 40 });
    await page.wait(120);
    await page.clickEl("text=Video", { ms: 300, pause: 40 });
    await page.waitFor("label=New title");
    await page.wait(200);
    await page.clickEl("label=New color matte", { ms: 450, pause: 40 });
    await page.wait(150);
    await page.clickEl("label=New title", { ms: 300, pause: 40 });
    const text = await page.waitFor("textarea");
    await Promise.all([page.zoom(text.cx, text.cy, 1.7, 750), page.move(text.x + 60, text.y + 14, 700)]);
    await page.click(undefined, undefined, { pause: 40, count: 3 });
    await page.type("Summer in Lisbon", 55);
    await page.key("Tab");
    await page.wait(250);
    // Scrub: the ruler above the tracks.
    const zero = await page.rect("text=0:00");
    const ruler = { x: zero.x, y: zero.cy };
    await page.unzoom(700, { wait: false });
    await Promise.all([page.move(ruler.x + 3, ruler.y, 650), page.wait(720)]);
    await Promise.all([page.zoom(620, 330, 1.45, 750), page.wait(100)]);
    await page.anchor({ x: ruler.x, y: ruler.y });
    await page.drag(ruler.x + 3, ruler.y, ruler.x + 170, ruler.y, 1150, undefined, 100);
    await page.mark("title");
    await page.wait(200);
    await page.drag(ruler.x + 170, ruler.y, ruler.x + 40, ruler.y, 800, undefined, 50);
    await page.wait(120);
    await page.drag(ruler.x + 40, ruler.y, ruler.x + 230, ruler.y, 750, undefined, 50);
    await page.wait(300);
    await page.anchor(null);
    await Promise.all([page.unzoom(750), page.move(ruler.x + 330, ruler.y + 120, 700)]);
    await page.wait(500);
};
module.exports.opts = { duration: 12, fade: 0.5, posterMark: "title", posterDelay: 0.1 };

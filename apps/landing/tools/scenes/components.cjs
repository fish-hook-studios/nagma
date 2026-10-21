// Components: the Premalu 2 screens (scenes/_app.cjs) with a loose "Join call" button beside them.
// The button becomes a component (⌥⌘K); the Assets panel lists the component and two instances go onto the
// screens; then the main component's colour changes and (zoomed in on the screens) both instances
// follow. Back out to the whole view.
const { buildApp, frameView, nodeRect } = require("./_app.cjs");

const selected = (page) => page.js("nagma.get().selection[0]");

// The first fill's hex field in the right panel, scrolled into view, clicked and selected.
async function hex(page) {
    await page.js(`(() => { document.querySelectorAll("[data-rec-hex]").forEach((e) => e.removeAttribute("data-rec-hex")); const i = [...document.querySelectorAll("input")].find((b) => (b.getAttribute("aria-label") || b.closest("label")?.title || "") === "Hex colour" && b.closest('[data-region="right"]')) || [...document.querySelectorAll("input")].find((b) => (b.getAttribute("aria-label") || b.closest("label")?.title || "") === "Hex colour"); if (!i) return false; i.setAttribute("data-rec-hex", "1"); const r = i.getBoundingClientRect(); if (r.top < 120 || r.bottom > innerHeight - 60) i.scrollIntoView({ block: "center" }); return true; })()`);
    await page.wait(150);
    const f = await page.waitFor("[data-rec-hex]");
    await page.click(f.cx, f.cy, { ms: 450, pause: 50 });
    await page.js(`(() => { const i = document.querySelector("[data-rec-hex]"); i.focus(); i.select(); })()`);
    return f;
}

module.exports = async function components(page) {
    const ids = await buildApp(page, { cta: null, join: false, loose: { x: -440, y: 380, label: "Join call" } });
    await frameView(page, { x: -460, y: 0, w: 1300, h: 844, margin: 30, offsetY: -20 });
    await page.wait(400);
    const A = await nodeRect(page, ids.Today);
    const B = await nodeRect(page, ids["Design review"]);
    const btn = await nodeRect(page, ids.Button);
    await page.move(btn.cx + 60, btn.bottom + 120, 1);
    const assets = await page.rect("label=Assets");
    page.start();
    await page.wait(400);
    // The loose button → a component.
    await page.click(btn.x + 12, btn.cy, { ms: 700, pause: 80 });
    await page.wait(400);
    await page.key("k", ["alt", "meta"]);
    await page.mark("component");
    await page.wait(500);
    // Assets: the component is listed; two instances go onto the screens.
    await page.click(assets.cx, assets.cy, { ms: 600, pause: 60 });
    await page.wait(250);
    await page.clickEl("text=Created in this file", { ms: 450, pause: 50 });
    await page.wait(200);
    const tile = await page.waitFor("[draggable=true]");
    for (const [S, i] of [[A, 0], [B, 1]]) {
        await page.click(tile.cx, tile.cy, { ms: 450, pause: 50 });
        await page.wait(150);
        const r = await nodeRect(page, await selected(page));
        await page.drag(r.x + 28, r.y - 13, S.cx - r.w / 2 + 28, S.y + (740 * S.h) / 844 - 13, 600, undefined, 250);
        await page.wait(150);
    }
    // The main component: a new colour, and both instances follow.
    const main = await nodeRect(page, ids.Button);
    await page.click(main.x + 12, main.cy, { ms: 550, pause: 60 });
    await page.wait(200);
    await hex(page);
    const mid = { x: (A.cx + B.cx) / 2, y: A.y + (767 * A.h) / 844 };
    await Promise.all([page.zoom(mid.x, mid.y - 60, 1.55, 750), page.move(mid.x + 10, mid.y + 50, 750)]);
    await page.wait(100);
    await page.type("4FAF78", 50);
    await page.key("Enter");
    await page.mark("update");
    await page.wait(900);
    await Promise.all([page.unzoom(750), page.move(mid.x + 120, mid.y + 70, 750)]);
    await page.wait(600);
};
module.exports.opts = { duration: 14, posterMark: "update", posterDelay: 0.6 };

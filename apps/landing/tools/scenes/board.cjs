// Board: real multiplayer. The board "Jailer 2 Cameos" lives on a scratch sync server (the web app's
// dev server started with VITE_SYNC_URL=ws://localhost:<port>, and that server running with its own
// DATA_DIR); five stickies sit in a loose cluster. Four people have it open: the recorded window is
// Fahadh Faasil; three more offscreen windows (each its own session) join by the file's edit link as
// Nelson, Thalaivar and Maran. Recorded, as Fahadh sees it: Nelson draws a section and names it
// "Cameos" while Thalaivar and Maran drag the cards into a 2 + 3 grid inside it, their named cursors
// moving over the board; zoomed in lightly on the arranging; ends still on the tidy layout.
//
// Setup (not recorded): an account from apps/server/seed-accounts.example.json is signed up on the
// scratch server, which owns the file; the file's link is opened for editing.
//   SYNC_HTTP=http://localhost:48991 (default)
const fs = require("node:fs");
const path = require("node:path");
const { setMe } = require("./_app.cjs");

const SYNC = process.env.SYNC_HTTP || "http://localhost:48991";
const APP = "http://localhost:5310/";
const CARDS = [
    ["Mohanlal", "#FFE299"],
    ["Shiva Rajkumar", "#FFA8DB"],
    ["Jacky Shroff", "#A8DAFF"],
    ["Roshan Bhai", "#B3EFBD"],
    ["Sethu", "#FFD3A8"],
];
// The loose cluster (world coordinates, sticky top-left).
const LOOSE = [
    [40, 60],
    [330, 10],
    [210, 300],
    [520, 250],
    [-10, 380],
];

async function api(method, url, body, token) {
    const res = await fetch(SYNC + url, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json)}`);
    return json;
}

// Signs up (or in) the first example account on the scratch server; its token.
async function account() {
    const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../server/seed-accounts.example.json"), "utf8")).accounts[0];
    try {
        return (await api("POST", "/auth/signup", { name: seed.name, email: seed.email, password: seed.password })).token;
    } catch {
        return (await api("POST", "/auth/signin", { email: seed.email, password: seed.password })).token;
    }
}

const BUILD = (cards, loose) => `(async () => {
  const [{ createBoardDocument, makeSticky }, { applyCommand }] = await Promise.all([import("/src/board/model.ts"), import("/src/engine/commands.ts")]);
  let doc = createBoardDocument("Jailer 2 Cameos");
  const page = doc.roots[0];
  const cards = ${JSON.stringify(cards)}, loose = ${JSON.stringify(loose)};
  cards.forEach(([text, color], i) => {
    const n = makeSticky(doc, loose[i][0], loose[i][1], color, page, "Fahadh Faasil");
    doc = applyCommand(doc, { type: "node.create", node: { ...n, text, name: text } });
  });
  return doc;
})()`;

// World → page coordinates in a window, from its own camera and canvas.
const toPage = (p, x, y) => p.js(`(() => { const s = nagma.get(); const c = document.querySelector('[data-region="canvas"]').getBoundingClientRect(); const z = s.camera.zoom; return { x: c.left + ${x} * z + s.camera.x, y: c.top + ${y} * z + s.camera.y }; })()`);
const camera = (p, cx, cy, zoom) => p.js(`(() => { const c = document.querySelector('[data-region="canvas"]').getBoundingClientRect(); nagma.set({ camera: { zoom: ${zoom}, x: c.width / 2 - ${cx} * ${zoom}, y: c.height / 2 - ${cy} * ${zoom} } }); })()`);
const stickies = (p) => p.js(`Object.values(nagma.get().doc.nodes).filter((n) => n.jam && n.jam.kind === "sticky").map((n) => ({ id: n.id, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h, parentId: n.parentId }))`);

async function join(p, link, name, color) {
    await p.ready();
    await setMe(p, name, color);
    await p.win.loadURL(link);
    for (let i = 0; i < 100; i++) {
        const n = await p.js(`(() => { try { return Object.values(nagma.get().doc.nodes).filter((n) => n.jam && n.jam.kind === "sticky").length; } catch (e) { return 0; } })()`).catch(() => 0);
        if (n === 5) break;
        await p.wait(150);
    }
    await p.wait(500);
}

module.exports = async function boardScene(page) {
    // The file on the scratch server, its link open for editing.
    const token = await account();
    const doc = await page.js(BUILD(CARDS, LOOSE));
    const made = await api("POST", "/files", { doc, kind: "board" }, token);
    await api("PUT", `/files/${made.id}/access?key=${made.keys.edit}`, { link: "edit" }, token);
    const link = `${APP}?file=${made.id}&key=${made.keys.edit}`;
    // Four people: Fahadh (recorded) and three guests.
    const people = [];
    for (const [name, color] of [["Nelson", "#14AE5C"], ["Thalaivar", "#9747FF"], ["Maran", "#F24822"]]) {
        const p = await page.extraWindow(APP);
        await join(p, link, name, color);
        people.push(p);
    }
    await join(page, link, "Fahadh Faasil", "#FF24BD");
    // Everyone looks at the same place: the cluster and room beside it.
    const view = { cx: 860, cy: 330, zoom: 0.6 };
    for (const p of [page, ...people]) await camera(p, view.cx, view.cy, view.zoom);
    await page.wait(600);
    const [nelson, thalaivar, maran] = people;
    const cards = Object.fromEntries((await stickies(page)).map((c) => [c.text, c]));
    // The 2 + 3 grid inside the section (world coordinates, sticky top-left).
    const SECTION = { x: 880, y: 20, w: 840, h: 620 };
    const SLOTS = { Mohanlal: [910, 70], "Shiva Rajkumar": [1180, 70], "Jacky Shroff": [1450, 70], "Roshan Bhai": [1045, 350], Sethu: [1315, 350] };
    const at = (p, x, y) => toPage(p, x, y);
    // Guests' cursors in view from the first frame.
    for (const [p, x, y] of [[nelson, 1500, 700], [thalaivar, 760, 600], [maran, 120, 160]]) {
        const q = await at(p, x, y);
        await p.move(q.x, q.y, 1);
    }
    await page.move(1180, 740, 1);
    await page.wait(400);
    page.start();
    await page.wait(500);
    const dragCard = async (p, name, ms = 900) => {
        const c = cards[name];
        const a = await at(p, c.x + 120, c.y + 150);
        const b = await at(p, SLOTS[name][0] + 120, SLOTS[name][1] + 150);
        await p.move(a.x, a.y, 550);
        await p.wait(200);
        await p.anchor('[data-region="canvas"]');
        await p.drag(a.x, a.y, b.x, b.y, ms, undefined, 1);
        await p.anchor(null);
        await p.wait(300);
    };
    // Nelson draws the section; the others head for the cards.
    const a0 = await at(nelson, SECTION.x, SECTION.y);
    const b0 = await at(nelson, SECTION.x + SECTION.w, SECTION.y + SECTION.h);
    const warm = Promise.all([
        (async () => { const q = await at(thalaivar, 520, 140); await thalaivar.move(q.x, q.y, 1200); })(),
        (async () => { const q = await at(maran, 300, 420); await maran.move(q.x, q.y, 1300); })(),
    ]);
    await nelson.move(a0.x, a0.y, 700);
    await nelson.key("s", ["shift"]);
    await nelson.wait(150);
    await nelson.anchor('[data-region="canvas"]');
    await nelson.drag(a0.x, a0.y, b0.x, b0.y, 1100, undefined, 1);
    await nelson.anchor(null);
    await warm;
    // In lightly on the arranging, while Nelson names the section and the cards go in.
    const z = await toPage(page, 1000, 330);
    await page.zoom(z.x, z.y, 1.15, 900, { wait: false });
    await Promise.all([
        (async () => {
            await nelson.wait(200);
            await nelson.click(a0.x + 30, a0.y + 12, { ms: 500, count: 2, pause: 80 });
            await nelson.wait(250);
            await nelson.key("a", ["meta"]);
            await nelson.type("Cameos", 70);
            await nelson.key("Enter");
            await nelson.wait(300);
            const r = await at(nelson, SECTION.x + SECTION.w - 40, SECTION.y - 50);
            await nelson.move(r.x, r.y, 900);
        })(),
        (async () => {
            await dragCard(thalaivar, "Mohanlal");
            await dragCard(thalaivar, "Shiva Rajkumar");
            await dragCard(thalaivar, "Jacky Shroff");
            const q = await at(thalaivar, SECTION.x + SECTION.w + 40, SECTION.y + SECTION.h - 120);
            await thalaivar.move(q.x, q.y, 700);
        })(),
        (async () => {
            await maran.wait(700);
            await dragCard(maran, "Roshan Bhai");
            await dragCard(maran, "Sethu");
            const q = await at(maran, SECTION.x - 60, SECTION.y + SECTION.h + 40);
            await maran.move(q.x, q.y, 800);
        })(),
    ]);
    await page.mark("tidy");
    await page.wait(300);
    await page.unzoom(900);
    await page.wait(1200);
};
module.exports.opts = { duration: 14, posterMark: "tidy", posterDelay: 0.6 };

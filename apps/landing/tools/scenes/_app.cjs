// Shared setup for the Design-type loops: opens a fresh file and fills it with "Premalu 2", a small
// team-agenda app (a Today list screen and a meeting detail screen) built from real layers: auto
// layout cards with an avatar, a title and a secondary line, a coloured header, a primary button.
// Built in the page through the editor's own modules (the dev server serves them), before the
// recording starts. Returns the layer ids by name.

const PALETTE = { ink: "#141413", cream: "#F6F1E7", pink: "#FC829A", green: "#4FAF78", mint: "#BFE6C8", yellow: "#F5C842", sky: "#8FC1F0", white: "#FFFFFF", card: "#F1F2F5", canvas: "#E6E8EC", muted: "#77726A", line: "#E7DFD0" };

const BUILD = (opts) => `(async () => {
  const P = ${JSON.stringify(PALETTE)};
  const O = ${JSON.stringify(opts)};
  const [{ applyCommand }, { makeNode }, { solid }, files] = await Promise.all([import("/src/engine/commands.ts"), import("/src/engine/nodes.ts"), import("/src/engine/paint.ts"), import("/src/engine/files.ts")]);
  let doc = { name: O.name, nodes: {}, roots: [], images: {} };
  const ids = {};
  const add = (type, rect, parentId, o = {}) => {
    const parent = parentId ? doc.nodes[parentId] : undefined;
    const placed = parent && parent.type !== "page" ? { ...rect, x: rect.x + parent.x, y: rect.y + parent.y } : rect;
    const node = makeNode(doc, type, placed, parentId, o);
    doc = applyCommand(doc, { type: "node.create", node });
    if (o.name) ids[o.name] = node.id;
    return node.id;
  };
  const text = (parent, x, y, value, o = {}) => add("text", { x, y, w: o.w || 10, h: o.h || 10 }, parent, { name: o.name || value.slice(0, 24), text: value, fills: [solid(o.color || P.ink)], fontSize: o.size || 15, fontWeight: o.weight || 500, ...(o.extra || {}) });
  const row = (gap, pad, extra = {}) => ({ direction: "horizontal", gap, padding: pad, primary: "start", counter: "center", ...extra });
  const col = (gap, pad, extra = {}) => ({ direction: "vertical", gap, padding: pad, primary: "start", counter: "start", ...extra });
  const pill = (parent, x, y, label, fill, color, name, size = 13) => {
    const f = add("frame", { x, y, w: 60, h: 28 }, parent, { name, fills: [solid(fill)], radius: 999, clip: false, layout: row(0, [6, 12, 6, 12]), sizing: { h: "hug", v: "hug" } });
    text(f, 0, 0, label, { size, weight: 600, color, name: name + " label" });
    return f;
  };
  const avatar = (parent, x, y, d, letter, fill, name) => {
    const f = add("frame", { x, y, w: d, h: d }, parent, { name, fills: [solid(fill)], radius: d / 2, clip: false, layout: row(0, [0, 0, 0, 0], { primary: "center" }) });
    text(f, 0, 0, letter, { size: Math.round(d * 0.38), weight: 700, name: name + " initial" });
    return f;
  };
  const button = (parent, y, label, fill, color, name) => {
    const b = add("frame", { x: 20, y, w: 350, h: 58 }, parent, { name, fills: [solid(fill)], radius: 18, clip: false, layout: row(0, [0, 0, 0, 0], { primary: "center" }) });
    text(b, 0, 0, label, { size: 17, weight: 600, color, name: name + " label" });
    return b;
  };
  const status = (s) => { text(s, 26, 16, "9:41", { size: 15, weight: 600, name: "Time" }); add("rect", { x: 330, y: 20, w: 36, h: 12 }, s, { name: "Battery", fills: [solid(P.ink)], radius: 4 }); };
  const homeBar = (s) => add("rect", { x: 128, y: 826, w: 134, h: 5 }, s, { name: "Home indicator", fills: [solid(P.ink)], radius: 3 });

  const page = add("page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Screens", fills: [solid(P.canvas)] });

  // Today: the agenda list.
  const A = add("frame", { x: 0, y: 0, w: 390, h: 844 }, page, { name: "Today", fills: [solid(P.white)], clip: true });
  const head = add("frame", { x: 0, y: 0, w: 390, h: 232 }, A, { name: "Header", fills: [solid(P.pink)], clip: true });
  add("ellipse", { x: 236, y: -70, w: 230, h: 230 }, head, { name: "Header glow", fills: [solid("#FFB3C1")], opacity: 0.6 });
  status(head);
  text(head, 26, 72, "Good morning", { size: 15, weight: 500, color: "#5A2A33", name: "Greeting" });
  text(head, 26, 94, O.user, { size: 34, weight: 700, name: "User name" });
  avatar(head, 318, 78, 48, O.user[0], P.yellow, "Avatar");
  pill(head, 26, 160, "3 meetings today", P.ink, P.cream, "Summary");
  text(A, 26, 254, "Today's agenda", { size: 19, weight: 700, name: "Agenda title" });
  text(A, 318, 258, "See all", { size: 14, weight: 500, color: P.muted, name: "See all" });
  const list = add("frame", { x: 20, y: 292, w: 350, h: 252 }, A, { name: "Agenda", fills: [], clip: false, ...(O.listLayout ? { layout: col(12, [0, 0, 0, 0]), sizing: { h: "fixed", v: "hug" } } : {}) });
  O.cards.forEach((c, i) => {
    const card = add("frame", { x: 0, y: i * 88, w: 350, h: 76 }, list, { name: c.name, fills: [solid(P.card)], radius: 20, clip: false, layout: row(14, [16, 16, 16, 16]), sizing: { h: "fixed", v: "hug" } });
    avatar(card, 0, 0, 44, c.letter, P[c.color], c.name + " avatar");
    const stack = add("frame", { x: 0, y: 0, w: 200, h: 40 }, card, { name: c.name + " text", fills: [], clip: false, layout: col(4, [0, 0, 0, 0]), sizing: { h: "fill", v: "hug" } });
    text(stack, 0, 0, c.title, { size: 16, weight: 600, name: c.name + " title", extra: { sizing: { h: "fill", v: "hug" } } });
    text(stack, 0, 0, c.sub, { size: 13, weight: 400, color: P.muted, name: c.name + " subtitle", extra: { sizing: { h: "fill", v: "hug" } } });
    pill(card, 0, 0, c.time, P.white, P.ink, c.name + " time", 12);
  });
  const focus = add("frame", { x: 20, y: 616, w: 350, h: 100 }, A, { name: "Focus block", fills: [solid(P.green)], radius: 20, clip: true });
  add("ellipse", { x: 250, y: -40, w: 150, h: 150 }, focus, { name: "Focus glow", fills: [solid(P.mint)], opacity: 0.45 });
  text(focus, 20, 22, "Focus block", { size: 18, weight: 700, color: P.white, name: "Focus title" });
  text(focus, 20, 52, "2:00 – 4:00 PM · No meetings", { size: 14, weight: 500, color: "#E6F5EA", name: "Focus time" });
  if (O.cta) button(A, 740, O.cta, P.ink, P.cream, "Primary button");
  homeBar(A);

  // Design review: the detail screen.
  if (O.detail) {
    const B = add("frame", { x: 450, y: 0, w: 390, h: 844 }, page, { name: "Design review", fills: [solid(P.white)], clip: true });
    const bh = add("frame", { x: 0, y: 0, w: 390, h: 292 }, B, { name: "Header", fills: [solid(P.sky)], clip: true });
    add("ellipse", { x: -80, y: 150, w: 260, h: 260 }, bh, { name: "Header glow", fills: [solid("#B7D8F6")], opacity: 0.7 });
    status(bh);
    const back = add("frame", { x: 20, y: 56, w: 40, h: 40 }, bh, { name: "Back", fills: [solid(P.white)], radius: 20, clip: false, layout: row(0, [0, 0, 0, 0], { primary: "center" }) });
    text(back, 0, 0, "‹", { size: 24, weight: 600, name: "Back glyph" });
    text(bh, 26, 122, "Design review", { size: 32, weight: 700, name: "Meeting title" });
    text(bh, 26, 166, "Today · 10:00 – 10:45 AM", { size: 15, weight: 500, color: "#22415E", name: "Meeting time" });
    pill(bh, 26, 210, "Room Kaveri · 2nd floor", P.white, P.ink, "Room");
    text(B, 26, 316, "People", { size: 19, weight: 700, name: "People title" });
    O.people.forEach((p, i) => {
      const r = add("frame", { x: 20, y: 352 + i * 70, w: 350, h: 60 }, B, { name: p.name, fills: [solid(P.card)], radius: 18, clip: false });
      avatar(r, 12, 12, 36, p.name[0], P[p.color], p.name + " avatar");
      text(r, 60, 11, p.name, { size: 15, weight: 600, name: p.name + " name" });
      text(r, 60, 32, p.role, { size: 13, weight: 400, color: P.muted, name: p.name + " role" });
    });
    text(B, 26, 578, "Notes", { size: 19, weight: 700, name: "Notes title" });
    const notes = add("frame", { x: 20, y: 612, w: 350, h: 100 }, B, { name: "Notes card", fills: [solid(P.card)], radius: 18, clip: false });
    text(notes, 18, 18, "Walk through the new onboarding screens and agree on the empty states before Friday.", { size: 14, weight: 400, name: "Notes body", w: 314, extra: { sizing: { h: "fixed", v: "hug" } } });
    if (O.join !== false) button(B, 740, "Join call", P.pink, P.ink, "Join button");
    homeBar(B);
  }
  // A loose button beside the screens, to become a component.
  if (O.loose) {
    const b = add("frame", { x: O.loose.x, y: O.loose.y, w: 168, h: 54 }, page, { name: "Button", fills: [solid(P.ink)], radius: 27, clip: false, layout: row(0, [0, 0, 0, 0], { primary: "center" }) });
    text(b, 0, 0, O.loose.label, { size: 16, weight: 600, color: P.cream, name: "Label" });
  }
  // Every text measured and laid out once more (fonts may have arrived since).
  nagma.loadDocument(doc);
  try { files.renameFile(nagma.get().fileId, O.name); } catch (e) {}
  return ids;
})()`;

const DEFAULTS = {
    name: "Premalu 2",
    user: "Gireesh",
    cta: "Start next meeting",
    listLayout: false,
    detail: true,
    cards: [
        { name: "Card 1", letter: "R", color: "mint", title: "Design review", sub: "With Reenu and Sachin", time: "10:00" },
        { name: "Card 2", letter: "D", color: "sky", title: "Sprint planning", sub: "Divya · Room Kaveri", time: "12:30" },
        { name: "Card 3", letter: "V", color: "yellow", title: "Coffee with Vishnu", sub: "Café, 3rd floor", time: "4:00" },
    ],
    people: [
        { name: "Reenu", role: "Host · Product design", color: "mint" },
        { name: "Sachin", role: "Engineering", color: "yellow" },
        { name: "Amal Davis", role: "Research", color: "pink" },
    ],
};

async function openBlank(page) {
    await page.win.loadURL("http://localhost:5310/?template=blank");
    await page.waitFor("text=Layers", 20000);
    await page.wait(800);
}

// Straight into a new file of a kind (?new=design|board|slides|campaign|site|make|video|document),
// with the local name set first. Waits for `ready` (a query) when given.
async function openNew(page, kind, ready, ms = 20000) {
    await page.win.loadURL(`http://localhost:5310/?new=${kind}`);
    await setMe(page);
    if (ready) await page.waitFor(ready, ms);
    await page.wait(700);
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
}

// The local person (signed out): their name on comments and the presence avatar.
async function setMe(page, name = "Fahadh Faasil", color = PALETTE.pink) {
    return page.js(`import("/src/engine/collab.ts").then((m) => { m.setMyName(${JSON.stringify(name)}, ${JSON.stringify(color)}); return m.collab.get().me; })`);
}

async function buildApp(page, opts = {}) {
    await openBlank(page);
    await setMe(page);
    const ids = await page.js(BUILD({ ...DEFAULTS, ...opts }));
    await page.wait(600);
    await page.js("document.fonts && document.fonts.ready.then(() => true)");
    await page.wait(300);
    return ids;
}

// Camera: world rect (x, y, w, h) fitted in the canvas with a margin, or { zoom, cx, cy }.
async function frameView(page, { x, y, w, h, margin = 60, zoom, offsetY = 0 }) {
    return page.js(`(() => { const c = document.querySelector('[data-region="canvas"]') || document.querySelector('canvas'); const r = c.getBoundingClientRect(); const z = ${zoom ?? "null"} ?? Math.min((r.width - ${margin} * 2) / ${w}, (r.height - ${margin} * 2) / ${h}); nagma.set({ camera: { zoom: z, x: r.width / 2 - (${x} + ${w} / 2) * z, y: r.height / 2 - (${y} + ${h} / 2) * z + ${offsetY} } }); return z; })()`);
}

// Page-coordinate rect of a layer on the canvas.
async function nodeRect(page, id) {
    return page.js(`(() => { const s = nagma.get(); const r = (window.__recGBCR || Element.prototype.getBoundingClientRect).call(document.querySelector('canvas')); const m = window.__recMatrix ? window.__recMatrix().inverse() : new DOMMatrix(); const c = m.transformPoint(new DOMPoint(r.left, r.top)); const n = s.doc.nodes[${JSON.stringify(id)}]; if (!n) return null; const z = s.camera.zoom; const l = c.x + n.x * z + s.camera.x, t = c.y + n.y * z + s.camera.y; return { x: l, y: t, w: n.w * z, h: n.h * z, cx: l + n.w * z / 2, cy: t + n.h * z / 2, right: l + n.w * z, bottom: t + n.h * z }; })()`);
}

// While the recorder's zoom (a CSS transform on <html>) is on, layout code that places popovers from
// getBoundingClientRect would see zoomed rects and put them in the wrong place. This makes rects
// report the page's own (unzoomed) coordinates until unpatched, so popovers land where they would.
async function patchRects(page, on) {
    await page.js(on
        ? `(() => { if (window.__recGBCR) return; const orig = Element.prototype.getBoundingClientRect; window.__recGBCR = orig; Element.prototype.getBoundingClientRect = function () { const r = orig.call(this); const t = document.documentElement.style.transform; if (!t || t === "none" || !window.__recMatrix) return r; const m = window.__recMatrix().inverse(); const a = m.transformPoint(new DOMPoint(r.left, r.top)); const b = m.transformPoint(new DOMPoint(r.right, r.bottom)); return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y); }; })()`
        : `(() => { if (window.__recGBCR) { Element.prototype.getBoundingClientRect = window.__recGBCR; delete window.__recGBCR; } })()`);
}
// Page-coordinate rect of the last visible element matching a CSS selector or exact text, while
// rects are patched (they're already in page coordinates then).
async function rawRect(page, q) {
    return page.js(`(() => { const q = ${JSON.stringify(q)}; let els; if (q.startsWith("text=")) { const t = q.slice(5); els = [...document.querySelectorAll("body *")].filter((e) => (e.textContent || "").trim() === t && ![...e.children].some((c) => (c.textContent || "").trim() === t)); } else els = [...document.querySelectorAll(q)]; els = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); const e = els[els.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
}

module.exports = { openNew, setMe, patchRects, rawRect, buildApp, frameView, nodeRect, openBlank, PALETTE, DEFAULTS };

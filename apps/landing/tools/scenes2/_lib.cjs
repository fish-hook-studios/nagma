// Shared helpers for the scenes2 recordings.
const PANEL = `[...document.querySelectorAll('input')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.x > 1000; })`;

async function fieldRect(a, match) {
  return a.js(`(() => { const m = ${JSON.stringify(match)};
    const el = ${PANEL}.find(b => (m.label && ((b.closest('label')?.title || '').startsWith(m.label) || (b.getAttribute('aria-label') || '').startsWith(m.label))) || (m.value !== undefined && b.value === m.value && b.getBoundingClientRect().x > (m.minX || 0)));
    if (!el) return null; if (m.scroll !== false) { const q = el.getBoundingClientRect(); if (q.y < 120 || q.y > 760) el.scrollIntoView({ block: 'center' }); } const r = el.getBoundingClientRect(); const l = el.closest('label')?.querySelector('span')?.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, lx: l ? l.x + l.width / 2 : null, ly: l ? l.y + l.height / 2 : null }; })()`);
}
async function field(a, match, value, perChar = 15) {
  let r = null;
  for (let i = 0; i < 20 && !r; i++) { r = await fieldRect(a, match); if (!r) await a.wait(100); }
  if (!r) throw new Error("no field " + JSON.stringify(match));
  await a.click(r.x, r.y);
  await a.js(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
  await a.type(value, perChar);
  await a.key("enter");
  await a.wait(150);
}
async function closeWelcome(a) {
  for (let i = 0; i < 20; i++) {
    const c = await a.rect('[aria-label="Get started with Nagma"] button[aria-label="Close"]');
    if (c) { await a.click(c.x, c.y, { ms: 200 }); return; }
    await a.wait(100);
  }
}
const dump = (a) => a.js(`${PANEL}.map(b=>{const r=b.getBoundingClientRect();return (b.closest('label')?.title||b.getAttribute('aria-label')||'')+'='+b.value+' @'+Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)}).join(' | ')`);
const buttons = (a, minX = 0) => a.js(`[...document.querySelectorAll('button,[role=button],[role=menuitem],[role=menuitemradio],[role=tab],[role=option]')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.x>=${minX}}).map(b=>{const r=b.getBoundingClientRect();return (b.getAttribute('aria-label')||b.title||b.textContent.trim()).slice(0,40)+' @'+Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2)}).join(' | ')`);
module.exports = { field, fieldRect, closeWelcome, dump, buttons };
// Screen rect of a layer (the canvas starts at its element's top-left; camera maps world to it).
async function nodeRect(a, id) {
  return a.js(`(() => { const s = nagma.get(); const c = document.querySelector('canvas').getBoundingClientRect();
    let n = s.doc.nodes[${JSON.stringify(id)}]; if (!n) return null; let x = n.x, y = n.y; const w = n.w, h = n.h;
    ${"/*REL*/"} let p = s.doc.nodes[n.parentId]; while (window.__relCoords && p && p.type !== 'page') { x += p.x; y += p.y; p = s.doc.nodes[p.parentId]; }
    const z = s.camera.zoom; const l = c.x + x * z + s.camera.x, t = c.y + y * z + s.camera.y;
    return { left: l, top: t, w: w * z, h: h * z, x: l + w * z / 2, y: t + h * z / 2, right: l + w * z, bottom: t + h * z }; })()`);
}
const nodes = (a) => a.js(`Object.values(nagma.get().doc.nodes).filter(n=>n.type!=='page').map(n=>({id:n.id,type:n.type,name:n.name,x:n.x,y:n.y,w:n.w,h:n.h,parentId:n.parentId,children:n.children}))`);
module.exports.nodeRect = nodeRect;
module.exports.nodes = nodes;
// The W or H field of the Layout section.
async function sizeField(a, which, value) {
  const r = await a.js(`(() => { document.querySelectorAll('[data-rec-target]').forEach(e => e.removeAttribute('data-rec-target')); const l = [...document.querySelectorAll('label')].find(l => { const r = l.getBoundingClientRect(); const sp = l.querySelector('span'); return r.x > 1000 && r.width && sp && sp.textContent.trim() === ${JSON.stringify(which)} && l.querySelector('input'); }); if (!l) return null; const i = l.querySelector('input'); i.setAttribute('data-rec-target', '1'); const q = i.getBoundingClientRect(); if (q.y < 120 || q.y > 760) i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!r) throw new Error("no size field " + which);
  await a.click(r.x, r.y);
  await a.js(`(() => { const i = document.querySelector('[data-rec-target]'); if (document.activeElement !== i) i.focus(); i.select(); })()`);
  await a.type(String(value), 5);
  await a.key("enter");
  await a.wait(150);
}
module.exports.sizeField = sizeField;

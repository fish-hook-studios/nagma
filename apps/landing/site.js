// Shared behaviour for the generated pages (tools/build-site.mjs): the home page's cursor and nav.

// Custom cursor: grows over links and buttons.
const cur = document.querySelector(".cur");
if (cur) {
  addEventListener("pointermove", (e) => { cur.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 3}px)`; }, { passive: true });
  document.querySelectorAll("a, button").forEach((el) => {
    el.addEventListener("pointerenter", () => cur.classList.add("big"));
    el.addEventListener("pointerleave", () => cur.classList.remove("big"));
  });
}

// Nav: hides on the way down, returns on the way up, always there near the top.
const navWrap = document.querySelector(".nav-wrap");
let lastY = scrollY;
addEventListener("scroll", () => {
  const y = scrollY;
  if (y < 12) navWrap.classList.remove("hide");
  else if (y > lastY + 2) navWrap.classList.add("hide");
  else if (y < lastY - 2) navWrap.classList.remove("hide");
  lastY = y;
}, { passive: true });

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

// Nav dropdowns: hover or click to open, Escape or a click elsewhere to close.
document.querySelectorAll(".menu").forEach((m) => {
  const btn = m.querySelector("button");
  let closeTimer = null;
  const open = () => { clearTimeout(closeTimer); document.querySelectorAll(".menu.open").forEach((o) => { if (o !== m) { o.classList.remove("open"); o.querySelector("button").setAttribute("aria-expanded", "false"); } }); m.classList.add("open"); btn.setAttribute("aria-expanded", "true"); };
  const close = () => { m.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
  m.addEventListener("pointerenter", open);
  m.addEventListener("pointerleave", () => { closeTimer = setTimeout(close, 180); });
  btn.addEventListener("click", () => (m.classList.contains("open") ? close() : open()));
  m.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".menu")) document.querySelectorAll(".menu.open").forEach((m) => { m.classList.remove("open"); m.querySelector("button").setAttribute("aria-expanded", "false"); }); });
// A product in the menu scrolls the rail to that card (on the home page; elsewhere it is a plain link).
document.querySelectorAll("[data-product]").forEach((a) => a.addEventListener("click", (e) => {
  const railEl = document.querySelector(".rail"); if (!railEl) return;
  e.preventDefault();
  const i = Number(a.dataset.product), total = railEl.offsetHeight - innerHeight;
  window.scrollTo({ top: railEl.offsetTop + (i / 7) * total, behavior: "smooth" });
  a.closest(".menu")?.classList.remove("open");
}));

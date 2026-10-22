// Shared behaviour for the generated pages (tools/build-site.mjs): the home page's cursor and nav.

// Phones: the page list folds behind a button that names the current page.
const side = document.querySelector(".side");
if (side) {
  const current = side.querySelector('[aria-current="page"]'), btn = document.createElement("button"), label = document.createElement("span");
  btn.type = "button"; btn.className = "side-toggle"; btn.setAttribute("aria-expanded", "false");
  label.textContent = current ? current.textContent : "All pages"; btn.append(label, document.createElement("i"));
  side.prepend(btn);
  btn.addEventListener("click", () => { const on = !side.classList.contains("open"); side.classList.toggle("open", on); btn.setAttribute("aria-expanded", String(on)); });
}

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
  if (navWrap.classList.contains("open")) return;
  const y = scrollY;
  if (y < 12) navWrap.classList.remove("hide");
  else if (y > lastY + 2) navWrap.classList.add("hide");
  else if (y < lastY - 2) navWrap.classList.remove("hide");
  lastY = y;
}, { passive: true });

// Phones and tablets: the menu button opens the links as a sheet under the bar. A link, Escape or a wider window closes it.
const navToggle = document.querySelector(".nav-toggle");
if (navToggle) {
  const setOpen = (on) => { navWrap.classList.toggle("open", on); navToggle.setAttribute("aria-expanded", String(on)); if (on) navWrap.classList.remove("hide"); };
  navToggle.addEventListener("click", () => setOpen(!navWrap.classList.contains("open")));
  navWrap.addEventListener("click", (e) => { if (e.target.closest("a") && navWrap.classList.contains("open")) setOpen(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && navWrap.classList.contains("open")) { setOpen(false); navToggle.focus(); } });
  const wide = matchMedia("(min-width: 961px)"), onWide = (e) => { if (e.matches) setOpen(false); };
  if (wide.addEventListener) wide.addEventListener("change", onWide); else wide.addListener(onWide);
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

// Nav dropdowns: hover or click to open, Escape or a click elsewhere to close.
document.querySelectorAll(".menu").forEach((m) => {
  const btn = m.querySelector("button");
  let closeTimer = null;
  const open = () => { clearTimeout(closeTimer); document.querySelectorAll(".menu.open").forEach((o) => { if (o !== m) { o.classList.remove("open"); o.querySelector("button").setAttribute("aria-expanded", "false"); } }); m.classList.add("open"); btn.setAttribute("aria-expanded", "true"); };
  const close = () => { m.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
  // Hover opens only for a mouse or pen: on a touch screen a tap would open and close in one go.
  m.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") open(); });
  m.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") closeTimer = setTimeout(close, 180); });
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

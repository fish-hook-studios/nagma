// The script every preview page runs before the app: it reports errors and when the app is up,
// draws the edit tool's hover and selection outlines and reports the elements clicked (⇧ click adds
// more), shows staged property changes before they're applied, reads the page as layers for
// "Copy as design layers", reports scrolling (for comment pins), and takes pictures of the page (a
// small one for the file's card on Home, a full one for drawing on). It talks to the editor by postMessage
// (the preview is sandboxed: its own opaque origin, no access to the editor).

export const PREVIEW_RUNTIME = String.raw`(function () {
  var post = function (m) { m.mk = 1; try { parent.postMessage(m, "*"); } catch (e) {} };
  var text = function (v) { return String(v && v.message ? v.message : v).slice(0, 2000); };
  window.addEventListener("error", function (e) { post({ type: "error", message: text(e.error || e.message), stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : "" }); });
  window.addEventListener("unhandledrejection", function (e) { post({ type: "error", message: text(e.reason) }); });
  var original = console.error;
  console.error = function () { try { post({ type: "console", message: Array.prototype.map.call(arguments, text).join(" ").slice(0, 2000) }); } catch (e) {} return original.apply(console, arguments); };
  window.__mkReady = function () { post({ type: "ready" }); };
  window.__mkFail = function (e) { post({ type: "error", message: text(e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : "" }); };

  var picking = false, selected = [], hoverBox = null, selectBoxes = [];
  function box(color, dashed) {
    var b = document.createElement("div");
    b.setAttribute("data-mk-ui", "");
    b.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:1.5px " + (dashed ? "dashed " : "solid ") + color + ";border-radius:2px;display:none;box-sizing:border-box;transition:all 60ms";
    document.documentElement.appendChild(b);
    return b;
  }
  function place(b, el) {
    if (!el || !el.isConnected) { b.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    b.style.display = "block"; b.style.left = r.left + "px"; b.style.top = r.top + "px"; b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }
  function sourced(el) {
    while (el && el.nodeType === 1) { if (el.getAttribute && el.getAttribute("data-mk-src")) return el; el = el.parentElement; }
    return null;
  }
  function ownText(el) {
    var out = "";
    for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) out += n.textContent; }
    return out.replace(/\s+/g, " ").trim();
  }
  var STYLE_KEYS = ["fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textAlign", "color", "backgroundColor", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "borderRadius", "opacity", "width", "height", "borderWidth", "borderColor"];
  function describe(el) {
    var cs = getComputedStyle(el), style = {};
    STYLE_KEYS.forEach(function (k) { style[k] = String(cs[k] || ""); });
    return { src: el.getAttribute("data-mk-src"), tag: el.tagName.toLowerCase(), text: ownText(el).slice(0, 500), html: el.outerHTML.replace(/ data-mk-src="[^"]*"/g, "").slice(0, 800), color: cs.color, background: cs.backgroundColor, classes: String(el.getAttribute("class") || "").slice(0, 300), style: style };
  }
  function bySrc(src) { return [].slice.call(document.querySelectorAll('[data-mk-src="' + String(src).replace(/"/g, "") + '"]')); }
  document.addEventListener("mousemove", function (e) {
    if (!picking) return;
    hoverBox = hoverBox || box("#0D99FF", true);
    place(hoverBox, sourced(e.target));
  }, true);
  document.addEventListener("click", function (e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    var el = sourced(e.target);
    if (!el) return;
    if (e.shiftKey) { if (selected.indexOf(el) < 0) selected.push(el); } else selected = [el];
    post(Object.assign({ type: "picked", add: e.shiftKey }, describe(el)));
  }, true);
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit"].forEach(function (name) {
    document.addEventListener(name, function (e) { if (picking) { e.preventDefault(); e.stopPropagation(); } }, true);
  });
  var lastY = -1;
  function follow() {
    while (selectBoxes.length < selected.length) selectBoxes.push(box("#0D99FF", false));
    selectBoxes.forEach(function (b, i) { place(b, selected[i] || null); });
    if (hoverBox && !picking) hoverBox.style.display = "none";
    if (scrollY !== lastY) { lastY = scrollY; post({ type: "scroll", y: scrollY, x: scrollX }); }
    requestAnimationFrame(follow);
  }
  requestAnimationFrame(follow);

  // The page as layers: boxes with a look of their own, text runs and pictures, in page coordinates.
  function layers() {
    var count = 0;
    function walk(el, depth) {
      if (count > 2000 || depth > 30 || (el.hasAttribute && el.hasAttribute("data-mk-ui"))) return null;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      count++;
      var node = { tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.getAttribute("id") || "").slice(0, 60), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, bg: cs.backgroundColor, bgImage: cs.backgroundImage !== "none", radius: parseFloat(cs.borderTopLeftRadius) || 0, borderWidth: parseFloat(cs.borderTopWidth) || 0, borderColor: cs.borderTopColor, opacity: Number(cs.opacity), shadow: cs.boxShadow !== "none", clip: cs.overflow !== "visible", img: el.tagName === "IMG" ? String(el.currentSrc || el.src || "").slice(0, 300) : (el.tagName === "svg" ? "svg" : null), children: [] };
      if (el.tagName === "svg" || el.tagName === "IMG") return node;
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) {
          var t = c.textContent.replace(/\s+/g, " ").trim();
          if (!t) continue;
          var range = document.createRange(); range.selectNodeContents(c);
          var tr = range.getBoundingClientRect();
          if (tr.width < 1) continue;
          node.children.push({ text: t, x: tr.left + scrollX, y: tr.top + scrollY, w: tr.width, h: tr.height, font: cs.fontFamily, size: parseFloat(cs.fontSize) || 16, weight: Number(cs.fontWeight) || 400, italic: cs.fontStyle === "italic", color: cs.color, align: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, decoration: cs.textDecorationLine, transform: cs.textTransform });
        } else if (c.nodeType === 1) {
          var child = walk(c, depth + 1);
          if (child) node.children.push(child);
        }
      }
      return node;
    }
    return { width: innerWidth, height: Math.max(document.documentElement.scrollHeight, innerHeight), background: getComputedStyle(document.body).backgroundColor, root: walk(document.body, 0) };
  }

  // The page drawn through an SVG foreignObject (no cloned frame: the sandbox can't reach one).
  function capture(id, full) {
    var w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    var bg = getComputedStyle(document.body).backgroundColor;
    import("https://esm.sh/html-to-image@1.11.11").then(function (m) {
      return m.toCanvas(document.body, { width: w, height: h, pixelRatio: full ? 1 : Math.min(1, 640 / w), style: { transform: "translate(" + (-scrollX) + "px," + (-scrollY) + "px)" }, backgroundColor: bg === "rgba(0, 0, 0, 0)" ? "#ffffff" : bg, filter: function (el) { return !(el.hasAttribute && el.hasAttribute("data-mk-ui")); } });
    }).then(function (canvas) {
      if (full) { post({ type: "captured", id: id, full: true, data: canvas.toDataURL("image/png") }); return; }
      var out = document.createElement("canvas"); out.width = 320; out.height = 200;
      var ctx = out.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 320, 200);
      var s = Math.max(320 / canvas.width, 200 / canvas.height);
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width * s, canvas.height * s);
      post({ type: "captured", id: id, data: out.toDataURL("image/jpeg", 0.8) });
    }).catch(function (e) { post({ type: "captured", id: id, error: text(e) }); });
  }

  window.addEventListener("message", function (e) {
    var d = e.data || {};
    if (e.source !== parent || !d.mk) return;
    if (d.type === "pick") {
      picking = Boolean(d.on);
      document.documentElement.style.cursor = picking ? "crosshair" : "";
      if (!picking && hoverBox) hoverBox.style.display = "none";
    }
    if (d.type === "clear") { selected = []; }
    if (d.type === "select" && Array.isArray(d.srcs)) {
      selected = [];
      d.srcs.forEach(function (src) { var el = bySrc(src)[0]; if (el) selected.push(el); });
    }
    // A staged change, shown straight away (the code changes on Apply).
    if (d.type === "stage" && d.src) {
      bySrc(d.src).forEach(function (el) {
        Object.keys(d.style || {}).forEach(function (k) { el.style[k] = d.style[k]; });
        if (typeof d.text === "string") {
          for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = d.text; break; } }
        }
      });
    }
    if (d.type === "layers") post({ type: "layers", tree: layers() });
    if (d.type === "scrollTo") scrollTo(d.x || 0, d.y || 0);
    if (d.type === "nav") { if (d.dir < 0) history.back(); else history.forward(); }
    if (d.type === "capture") capture(d.id, d.full);
  });
})();`;
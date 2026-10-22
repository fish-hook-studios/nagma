// The script every Live frame runs before its own code. It gives the code `nagma` (props in, events
// out, a declared schema), reports errors, forwards Escape so the person can leave the frame, and
// answers "snapshot" with a PNG of what it shows: the document serialised into an SVG foreignObject
// and drawn on a canvas inside the frame (the frame is sandboxed with its own opaque origin, so the
// editor can't read it any other way). It talks to the editor only by postMessage.
//
// `__NL_PROPS__` and `__NL_VARS__` are replaced with the initial props and variable values (JSON,
// with "<" escaped) when the frame's document is built (engine/live.ts).

export const LIVE_RUNTIME = String.raw`(function () {
  var props = __NL_PROPS__;
  var variables = __NL_VARS__;
  var listeners = { props: [], variables: [] };
  var post = function (m) { m.nl = 1; try { parent.postMessage(m, "*"); } catch (e) { try { parent.postMessage(JSON.parse(JSON.stringify(m)), "*"); } catch (e2) {} } };
  var text = function (v) { return String(v && v.message ? v.message : v).slice(0, 2000); };
  window.addEventListener("error", function (e) { post({ type: "error", message: text(e.error || e.message), line: e.lineno || 0 }); });
  window.addEventListener("unhandledrejection", function (e) { post({ type: "error", message: text(e.reason) }); });
  var plain = function (v) {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
  };
  window.nagma = {
    get props() { return props; },
    get variables() { return variables; },
    on: function (name, fn) {
      var list = listeners[name];
      if (!list || typeof fn !== "function") return function () {};
      list.push(fn);
      return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
    emit: function (name, detail) { post({ type: "emit", name: String(name).slice(0, 80), detail: plain(detail) }); },
    declare: function (schema) {
      var props = Array.isArray(schema) ? schema : schema && Array.isArray(schema.props) ? schema.props : [];
      var events = schema && !Array.isArray(schema) && Array.isArray(schema.events) ? schema.events : [];
      post({ type: "declare", schema: plain(props), events: plain(events) });
    }
  };
  var call = function (list, value) { list.slice().forEach(function (fn) { try { fn(value); } catch (e) { post({ type: "error", message: text(e) }); } }); };

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") post({ type: "escape" }); }, true);
  // Interactions inside the frame (a click on the counter) change what it shows: a fresh picture follows.
  var changed = 0;
  var touched = function () { clearTimeout(changed); changed = setTimeout(function () { post({ type: "changed" }); }, 400); };
  ["pointerup", "keyup", "input", "change"].forEach(function (name) { document.addEventListener(name, touched, true); });

  // ---- Snapshot ----
  var selectorFix = function (sel) { return sel.replace(/(^|[\s,>+~(])html(?![\w-])/g, "$1.nl-html").replace(/(^|[\s,>+~(])body(?![\w-])/g, "$1.nl-body").replace(/:root(?![\w-])/g, ".nl-html"); };
  var ruleText = function (rule) {
    if (rule.selectorText !== undefined && rule.style) return selectorFix(rule.selectorText) + "{" + rule.style.cssText + "}";
    if (rule.cssRules && rule.conditionText !== undefined) {
      var inner = "";
      for (var i = 0; i < rule.cssRules.length; i++) inner += ruleText(rule.cssRules[i]);
      return (rule.type === 4 ? "@media " : "@supports ") + rule.conditionText + "{" + inner + "}";
    }
    return rule.cssText || "";
  };
  var styles = function () {
    var out = "";
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; j < rules.length; j++) out += ruleText(rules[j]) + "\n";
    }
    return out;
  };
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
  var copyState = function (from, to) {
    // Form values, canvases and scroll positions aren't in the markup: write them into the copy.
    var a = from.querySelectorAll("input, textarea, select, canvas");
    var b = to.querySelectorAll("input, textarea, select, canvas");
    for (var i = 0; i < a.length && i < b.length; i++) {
      var src = a[i], dst = b[i];
      if (src.tagName === "CANVAS") {
        try {
          var img = document.createElement("img");
          img.src = src.toDataURL("image/png");
          img.setAttribute("style", (src.getAttribute("style") || "") + ";width:" + src.clientWidth + "px;height:" + src.clientHeight + "px");
          img.className = src.className;
          dst.parentNode.replaceChild(img, dst);
        } catch (e) {}
      } else if (src.tagName === "TEXTAREA") dst.textContent = src.value;
      else if (src.tagName === "SELECT") { for (var k = 0; k < dst.options.length; k++) { if (k === src.selectedIndex) dst.options[k].setAttribute("selected", ""); else dst.options[k].removeAttribute("selected"); } }
      else if (src.type === "checkbox" || src.type === "radio") { if (src.checked) dst.setAttribute("checked", ""); else dst.removeAttribute("checked"); }
      else dst.setAttribute("value", src.value);
    }
  };
  var snapshot = function (id, scale) {
    var w = Math.max(1, document.documentElement.clientWidth || innerWidth), h = Math.max(1, document.documentElement.clientHeight || innerHeight);
    var k = Math.max(0.25, Math.min(4, Number(scale) || 1));
    try {
      var body = document.body.cloneNode(true);
      copyState(document.body, body);
      var scripts = body.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i++) scripts[i].parentNode.removeChild(scripts[i]);
      var htmlStyle = document.documentElement.getAttribute("style") || "";
      var bodyStyle = document.body.getAttribute("style") || "";
      var bodyClass = document.body.className ? " " + document.body.className : "";
      var markup = new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "");
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w * k + '" height="' + h * k + '" viewBox="0 0 ' + w + " " + h + '">' +
        '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" class="nl-html" style="width:' + w + "px;height:" + h + "px;overflow:hidden;" + esc(htmlStyle) + '">' +
        "<style>" + styles().replace(/</g, "\\3c ") + "</style>" +
        '<div class="nl-body' + esc(bodyClass) + '" style="height:100%;' + esc(bodyStyle) + '">' + markup + "</div></div></foreignObject></svg>";
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          post({ type: "snapshot", id: id, data: canvas.toDataURL("image/png"), w: w, h: h });
        } catch (e) { post({ type: "snapshot", id: id, error: text(e) }); }
      };
      img.onerror = function () { post({ type: "snapshot", id: id, error: "The frame could not be pictured." }); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } catch (e) { post({ type: "snapshot", id: id, error: text(e) }); }
  };

  window.addEventListener("message", function (e) {
    var d = e.data || {};
    if (e.source !== parent || !d.nl) return;
    if (d.type === "props" && d.props && typeof d.props === "object") {
      props = d.props;
      if (d.variables && typeof d.variables === "object") { variables = d.variables; call(listeners.variables, variables); }
      call(listeners.props, props);
    }
    if (d.type === "snapshot") snapshot(d.id, d.scale);
  });
  window.addEventListener("load", function () { post({ type: "ready" }); });
})();`;

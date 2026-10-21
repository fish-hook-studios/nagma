#!/usr/bin/env node
// Builds nagma.app into apps/landing/dist: the home page, its assets, and a page for every guide,
// project file and studio page, each in the home page's shell (nav, footer, cursor, type).
// No dependencies: Node 22 built-ins only, with its own small markdown converter.
//
//   node apps/landing/tools/build-site.mjs
//
// The releases page lists https://api.github.com/repos/fish-hook-studios/nagma/releases, fetched
// at build time (GITHUB_TOKEN is used when set). When that fails it shows the stable download links.
// NAGMA_RELEASES_JSON=<file> reads the list from a file instead, for trying the page offline.
// After writing, every internal link and #anchor on every page is checked; a broken one fails the build.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stampLoops } from "./stamp-loops.mjs";
import { createHash } from "node:crypto";

const LANDING = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(LANDING, "../..");
const DIST = join(LANDING, "dist");
const SITE = "https://nagma.app";
const REPO = "https://github.com/fish-hook-studios/nagma";
const RAW = "https://raw.githubusercontent.com/fish-hook-studios/nagma/main/";
const RELEASES_API = "https://api.github.com/repos/fish-hook-studios/nagma/releases";

// Every generated page. `src` is relative to the repository root.
const GUIDES = [
  { src: "docs/getting-started.md", url: "/docs/getting-started/", label: "Getting started" },
  { src: "docs/connect-to-a-server.md", url: "/docs/connect-to-a-server/", label: "Connect to a server" },
  { src: "docs/self-hosting.md", url: "/docs/self-hosting/", label: "Self-hosting" },
  { src: "docs/ai-keys.md", url: "/docs/ai-keys/", label: "AI keys" },
  { src: "docs/load-testing.md", url: "/docs/load-testing/", label: "Load testing" },
  { src: "docs/releasing.md", url: "/docs/releasing/", label: "Releasing" },
];
const PROJECT = [
  { url: "/releases/", label: "Releases", kind: "releases" },
  { src: "CONTRIBUTING.md", url: "/contributing/", label: "Contributing" },
  { src: "SECURITY.md", url: "/security/", label: "Security" },
  { src: "CODE_OF_CONDUCT.md", url: "/code-of-conduct/", label: "Code of conduct" },
  { src: "THIRD_PARTY_NOTICES.md", url: "/third-party/", label: "Third-party notices" },
  { src: "LICENSE", url: "/licence/", label: "Licence", kind: "licence", single: true },
];
const STUDIO = [
  { src: "apps/landing/pages/about.md", url: "/about/", label: "About", single: true },
  { src: "apps/landing/pages/contact.md", url: "/contact/", label: "Contact", single: true },
];
const SIDEBAR = [["Guides", GUIDES], ["Project", PROJECT], ["Studio", STUDIO]];
const PAGE_BY_SRC = Object.fromEntries([...GUIDES, ...PROJECT, ...STUDIO].filter((p) => p.src).map((p) => [p.src, p.url]));

const DOWNLOADS = [
  ["macOS", "Apple silicon", "Nagma-mac-arm64.dmg"],
  ["macOS", "Intel", "Nagma-mac-x64.dmg"],
  ["Windows", "Installer, x64", "Nagma-Setup-x64.exe"],
  ["Linux", "AppImage, x64", "Nagma-x86_64.AppImage"],
  ["Linux", "Debian and Ubuntu, x64", "Nagma-amd64.deb"],
];
// Files copied from apps/landing as they are; the home page refers to these.
// The shared stylesheet and script carry a hash of their file in the pages' links, so a change is never served from a browser's cache.
const ASSET_V = Object.fromEntries([["css", "site.css"], ["js", "site.js"]].map(([k, f]) => [k, createHash("sha1").update(readFileSync(join(LANDING, f))).digest("hex").slice(0, 8)]));
const COPY = ["img", "fonts", "insignia.svg", "insignia-cat.svg", "wordmark.svg", "logo-full.svg", "logo-mark.svg", "logo.svg", "favicon.svg", "robots.txt", "_redirects", "site.css", "site.js"];

// ---------------------------------------------------------------------------------------------
// Markdown

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escText = (s) => String(s).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stripTags = (s) => s.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const norm = (label) => label.trim().replace(/\s+/g, " ").toLowerCase();
// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");

const RE = {
  fence: /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/,
  atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>/,
  item: /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/,
  tableDelim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
  html: /^ {0,3}<\/?(?:div|details|summary|p|table|thead|tbody|tr|td|th|img|br|picture|source|section|figure|figcaption|video|h[1-6]|ul|ol|li|pre|blockquote|hr)\b/i,
};

function matchItem(line) {
  const m = line.match(RE.item);
  if (!m) return null;
  const [, indent, marker, gap, text] = m;
  const ordered = /\d/.test(marker);
  // Content starts after the marker and its spaces; five or more spaces mean code, so count one.
  const pad = gap.length >= 1 && gap.length <= 4 ? gap.length : 1;
  return { indent: indent.length, ordered, start: ordered ? parseInt(marker, 10) : 1, col: indent.length + marker.length + pad, text: gap.length > 4 ? gap.slice(1) + text : text };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "", tick = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") { cur += "\\|"; k++; continue; }
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && RE.tableDelim.test(lines[i + 1]) && splitRow(lines[i]).length === splitRow(lines[i + 1]).length;

// Lines that end a paragraph without a blank line.
function interrupts(lines, i) {
  const l = lines[i];
  if (RE.atx.test(l) || RE.fence.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.html.test(l) || isTableStart(lines, i)) return true;
  const it = matchItem(l);
  return Boolean(it && it.text.trim() && (!it.ordered || it.start === 1));
}

export function markdown(src, opt = {}) {
  const ctx = { refs: new Map(), ids: new Map(), srcPath: opt.srcPath ?? null, shift: opt.headingShift ?? 0, idPrefix: opt.idPrefix ?? "" };
  const lines = [];
  let inFence = false;
  for (const l of src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
    if (RE.fence.test(l)) inFence = !inFence;
    const ref = !inFence && l.match(/^ {0,3}\[([^\]]+)\]:[ \t]*<?(\S+?)>?(?:[ \t]+["'(](.*)["')])?[ \t]*$/);
    if (ref) { ctx.refs.set(norm(ref[1]), { href: ref[2], title: ref[3] }); continue; }
    lines.push(l);
  }
  return blocks(lines, ctx, false);
}

function blocks(lines, ctx, tight) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(RE.fence))) {
      const indent = m[1].length, fence = m[2], lang = m[3];
      const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      const body = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ""));
      i++;
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = line.match(RE.atx))) { out.push(heading(m[1].length, m[2] ?? "", ctx)); i++; continue; }
    if (RE.hr.test(line)) { out.push("<hr>"); i++; continue; }
    if (RE.quote.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || body.length)) { body.push(lines[i].replace(/^ {0,3}> ?/, "")); i++; }
      out.push(`<blockquote>\n${blocks(body, ctx, false)}\n</blockquote>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      const cell = (tag, text, k) => `<${tag}${align[k] ? ` style="text-align: ${align[k]}"` : ""}>${inline(text, ctx)}</${tag}>`;
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(splitRow(lines[i]));
      out.push(`<div class="table"><table>\n<thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k] ?? "", k)).join("")}</tr>`).join("\n")}\n</tbody></table></div>`);
      continue;
    }
    if (matchItem(line)) { const r = list(lines, i, ctx); out.push(r.html); i = r.next; continue; }
    if (RE.html.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
      out.push(body.join("\n"));
      continue;
    }
    // Paragraph, or a setext heading when underlined.
    const para = [line.trimStart()];
    let setext = 0;
    for (i++; i < lines.length && lines[i].trim(); i++) {
      if ((m = lines[i].match(RE.setext))) { setext = m[1][0] === "=" ? 1 : 2; i++; break; }
      if (interrupts(lines, i)) break;
      para.push(lines[i].trimStart());
    }
    const text = para.join("\n").trimEnd();
    if (setext) out.push(heading(setext, text.replace(/\n/g, " "), ctx));
    else out.push(tight ? inline(text, ctx) : `<p>${inline(text, ctx)}</p>`);
  }
  return out.join("\n");
}

function list(lines, i, ctx) {
  const first = matchItem(lines[i]);
  const items = [];
  let loose = false;
  while (i < lines.length) {
    const it = matchItem(lines[i]);
    if (!it || it.ordered !== first.ordered || it.indent >= first.col) break;
    if (items.length && items.at(-1).blankAfter) loose = true;
    const body = [it.text];
    let blank = false;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { body.push(""); blank = true; continue; }
      const indent = l.match(/^ */)[0].length;
      if (indent >= it.col) { body.push(l.slice(it.col)); blank = false; continue; }
      if (blank) break;
      // Lazy continuation of the item's paragraph.
      if (matchItem(l) || RE.atx.test(l) || RE.fence.test(l) || RE.hr.test(l) || RE.quote.test(l)) break;
      body.push(l.trim());
    }
    let blankAfter = false;
    while (body.length && !body.at(-1).trim()) { body.pop(); blankAfter = true; }
    if (body.some((l, k) => !l.trim() && k > 0)) loose = true;
    items.push({ body, blankAfter });
  }
  const tag = first.ordered ? "ol" : "ul";
  const start = first.ordered && first.start !== 1 ? ` start="${first.start}"` : "";
  const html = `<${tag}${start}>\n${items.map((it) => `<li>${blocks(it.body, ctx, !loose)}</li>`).join("\n")}\n</${tag}>`;
  return { html, next: i };
}

function heading(level, raw, ctx) {
  const inner = inline(raw.trim(), ctx);
  let id = ctx.idPrefix + slug(stripTags(inner));
  const n = ctx.ids.get(id) ?? 0;
  ctx.ids.set(id, n + 1);
  if (n) id += `-${n}`;
  const h = Math.min(6, level + ctx.shift);
  return `<h${h} id="${esc(id)}">${inner}</h${h}>`;
}

// Where a link in a source file goes on the site: other pages by their URL, other repository
// files on GitHub, everything else as written.
function rewrite(href, ctx, image = false) {
  const gh = href.match(/^https:\/\/github\.com\/fish-hook-studios\/nagma\/blob\/main\/([^#?]+)(#.*)?$/);
  if (gh && !image && PAGE_BY_SRC[gh[1]]) return PAGE_BY_SRC[gh[1]] + (gh[2] ?? "");
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href) || !ctx.srcPath) return href;
  const [path, ...hashParts] = href.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  const rel = posix.normalize(posix.join(posix.dirname(ctx.srcPath), decodeURI(path))).replace(/\/$/, "");
  if (rel.startsWith("..")) return href;
  if (image) return RAW + encodeURI(rel);
  if (PAGE_BY_SRC[rel]) return PAGE_BY_SRC[rel] + hash;
  const abs = join(ROOT, rel);
  const dir = existsSync(abs) && statSync(abs).isDirectory();
  return `${REPO}/${dir ? "tree" : "blob"}/main/${encodeURI(rel)}${hash}`;
}

function inline(text, ctx) {
  const tokens = [];
  const ph = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  const link = (href, inner, title) => `<a href="${esc(rewrite(href, ctx))}"${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`;
  const run = (s, inLink = false) => {
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => ph(`<code>${esc(c.replace(/\n/g, " ").replace(/^ (.+) $/, "$1"))}</code>`));
    s = s.replace(/\\\n/g, () => ph("<br>\n"));
    s = s.replace(/\\([!-/:-@[-`{-~])/g, (_, c) => ph(esc(c)));
    if (!inLink) {
      s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_, u) => ph(link(u, esc(u.replace(/^mailto:/, "")))));
      s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_, alt, src, title) =>
        ph(`<img src="${esc(rewrite(src, ctx, true))}" alt="${esc(stripTags(alt))}"${title ? ` title="${esc(title)}"` : ""} loading="lazy">`));
      s = s.replace(/\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+"([^"]*)")?\s*\)/g, (_, txt, href, title) => ph(link(href, run(txt, true), title)));
      s = s.replace(/\[((?:[^[\]]|\[[^[\]]*\])*)\]\[([^\]]*)\]/g, (m, txt, label) => {
        const r = ctx.refs.get(norm(label || txt));
        return r ? ph(link(r.href, run(txt, true), r.title)) : m;
      });
      s = s.replace(/\[([^[\]]+)\](?!\()/g, (m, label) => {
        const r = ctx.refs.get(norm(label));
        return r ? ph(link(r.href, run(label, true), r.title)) : m;
      });
      s = s.replace(/\bhttps?:\/\/[^\s<>\u0000]*[^\s<>\u0000.,:;!?"')\]*_]/g, (u) => ph(link(u, esc(u))));
    }
    s = s.replace(/ {2,}\n/g, () => ph("<br>\n"));
    s = escText(s);
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
      .replace(/\*(?=\S)([\s\S]*?\S)\*/g, "<em>$1</em>")
      .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
  };
  let out = run(text);
  while (/\u0000\d+\u0000/.test(out)) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => tokens[n]);
  return out;
}

// LICENSE is plain text: underlined titles become headings, the boxed sections are unboxed, and
// each paragraph is reflowed, keeping its indent.
function licence(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
    .filter((l) => !/^\*{10,}\s*$/.test(l))
    .map((l) => { const m = l.match(/^\* {1,2}(.*?)\s*\*\s*$/); return m ? m[1] : l; });
  const ids = new Map();
  const autolink = (s) => esc(s).replace(/https?:\/\/[^\s<]*[^\s<.,;:)]/g, (u) => `<a href="${u}">${u}</a>`);
  const out = [];
  const blocksOf = [];
  let cur = [];
  for (const l of lines) { if (l.trim()) cur.push(l); else if (cur.length) { blocksOf.push(cur); cur = []; } }
  if (cur.length) blocksOf.push(cur);
  for (const block of blocksOf) {
    const under = block.at(-1).match(/^\s*([-=])\1{2,}\s*$/);
    if (under && block.length > 1) {
      const title = block.slice(0, -1).map((l) => l.trim()).join(" ");
      const h = under[1] === "=" ? 2 : 3;
      let id = slug(title);
      const n = ids.get(id) ?? 0; ids.set(id, n + 1); if (n) id += `-${n}`;
      out.push(`<h${h} id="${esc(id)}">${esc(title)}</h${h}>`);
      continue;
    }
    // Group lines into paragraphs by indent; "(a)" items keep their hanging lines.
    const groups = [];
    for (const l of block) {
      const d = l.match(/^ */)[0].length;
      const g = groups.at(-1);
      if (g && (d === g.d || (d > g.d && /^\(\w+\)\s/.test(g.lines[0])))) g.lines.push(l.trim());
      else groups.push({ d, lines: [l.trim()] });
    }
    for (const g of groups) {
      const term = g.lines.length === 1 && /^\d+(?:\.\d+)+\.\s/.test(g.lines[0]);
      const cls = [term ? "term" : "", g.d ? `i${Math.min(3, Math.round(g.d / 4))}` : ""].filter(Boolean).join(" ");
      out.push(`<p${cls ? ` class="${cls}"` : ""}>${autolink(g.lines.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Shell: the home page's head, nav and footer.

// The loops carry a hash of their file, so a re-recorded one is never served from a browser's cache.
const home = stampLoops(readFileSync(join(LANDING, "home.html"), "utf8"));
const pick = (re, what) => { const m = home.match(re); if (!m) throw new Error(`home.html: couldn't find the ${what}`); return m[0]; };
// Same-page links on the home page point back at it from the other pages.
const toSite = (html) => html.replace(/href="#top"/g, 'href="/"').replace(/href="#([^"]+)"/g, 'href="/#$1"').replace(/src="(insignia[^"/]*\.svg)"/g, 'src="/$1"');
const NAV = toSite(pick(/<div class="nav-wrap">[\s\S]*?<\/nav>\s*<\/div>/, "nav"));
const FOOTER = toSite(pick(/<footer class="foot"[\s\S]*?<\/footer>/, "footer")).replace(/ data-bg="[^"]*" data-fg="[^"]*"/, "");
const CURSOR = pick(/<div class="cur"[^>]*>[\s\S]*?<\/div>/, "cursor");
const SYMBOLS = [...NAV.matchAll(/<use href="\/#([^"]+)"\/>/g)].map((m) => m[1]);
const NAV_LOCAL = NAV.replace(/<use href="\/#([^"]+)"\/>/g, '<use href="#$1"/>');
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\n${[...new Set(SYMBOLS)].map((id) => pick(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`), `symbol ${id}`)).join("\n")}\n</defs></svg>`;
const FONTS = pick(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">[\s\S]*?rel="stylesheet">/, "font links");

function describe(html) {
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const text = p ? stripTags(p[1]).replace(/\s+/g, " ").trim() : "";
  if (text.length <= 160) return text;
  return text.slice(0, 157).replace(/\s+\S*$/, "") + "...";
}

function sidebar(current) {
  return `<nav class="side" aria-label="Guides and pages">\n${SIDEBAR.map(([name, pages]) =>
    `<b>${name}</b>\n<ul>${pages.map((p) => `<li><a href="${p.url}"${p.url === current ? ' aria-current="page"' : ""}>${esc(p.label)}</a></li>`).join("")}</ul>`).join("\n")}\n</nav>`;
}

function page({ url, title, description, body, single = false, extraClass = "" }) {
  const article = `<article class="prose${extraClass ? ` ${extraClass}` : ""}">\n${body}\n</article>`;
  const main = single
    ? `<main class="page-main single" id="top">\n<div class="wrap">\n${article}\n</div>\n</main>`
    : `<main class="page-main" id="top">\n<div class="wrap doc">\n${sidebar(url)}\n${article}\n</div>\n</main>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Nagma</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${url}">
<meta property="og:title" content="${esc(title)} | Nagma">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/img/og.png">
${FONTS}
<link rel="stylesheet" href="/site.css?v=${ASSET_V.css}">
</head>
<body>
${CURSOR}
${SPRITE}

${NAV_LOCAL}

${main}

${FOOTER}

<script src="/site.js?v=${ASSET_V.js}"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Pages

function frontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^(\w+):\s*(.*)$/); if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, ""); }
  return { data, body: src.slice(m[0].length) };
}

function markdownPage(p) {
  const { data, body } = frontMatter(readFileSync(join(ROOT, p.src), "utf8"));
  let html = markdown(body, { srcPath: p.src });
  let title = data.title;
  if (title) html = `<h1 id="${esc(slug(title))}">${esc(title)}</h1>\n${html}`;
  else title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? p.label);
  if (!p.single) html += `\n<p class="edit"><a href="${REPO}/edit/main/${p.src}">Edit this page on GitHub</a></p>`;
  return { url: p.url, title, description: data.description || describe(html), body: html, single: p.single };
}

function licencePage(p) {
  const body = `<h1 id="licence">Licence</h1>\n${licence(readFileSync(join(ROOT, p.src), "utf8"))}`;
  return { url: p.url, title: "Licence", description: "Nagma is open source under the Mozilla Public License 2.0. The full text of the licence.", body, single: true, extraClass: "licence" };
}

async function loadReleases() {
  if (process.env.NAGMA_RELEASES_JSON) return { list: JSON.parse(readFileSync(process.env.NAGMA_RELEASES_JSON, "utf8")) };
  try {
    const headers = { accept: "application/vnd.github+json", "user-agent": "nagma-site-build" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`${RELEASES_API}?per_page=50`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("not a list");
    return { list };
  } catch (e) {
    return { list: [], error: e.message };
  }
}

const PLATFORMS = ["macOS", "Windows", "Linux", "Other"];
function platformOf(name) {
  const n = name.toLowerCase();
  if (/\.(blockmap|ya?ml)$/.test(n)) return null; // the updater's metadata, not downloads
  if (/\.dmg$|\.pkg$|mac|darwin/.test(n)) return "macOS";
  if (/\.exe$|\.msi$|\.msix$|win/.test(n)) return "Windows";
  if (/\.appimage$|\.deb$|\.rpm$|\.snap$|linux/.test(n)) return "Linux";
  return "Other";
}
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
const assetCards = (groups) => `<div class="assets">\n${groups.map(([name, items]) =>
  `<div class="asset-group"><b>${esc(name)}</b><ul>${items.map((a) => `<li><a href="${esc(a.href)}">${esc(a.label)}</a>${a.note ? `<span>${esc(a.note)}</span>` : ""}</li>`).join("")}</ul></div>`).join("\n")}\n</div>`;

async function releasesPage(p) {
  const { list, error } = await loadReleases();
  const releases = list.filter((r) => !r.draft);
  let body = `<h1 id="releases">Releases</h1>\n`;
  if (!releases.length) {
    if (error) console.warn(`releases: couldn't load the list (${error}); the page shows the stable download links.`);
    const groups = [];
    for (const [platform, label, file] of DOWNLOADS) {
      let g = groups.find(([n]) => n === platform);
      if (!g) groups.push((g = [platform, []]));
      g[1].push({ href: `${REPO}/releases/latest/download/${file}`, label, note: file.replace(/^.*\./, ".") });
    }
    body += `<p class="quiet">The list of releases couldn't be loaded when this page was built. The newest installers are always at these addresses:</p>\n${assetCards(groups)}\n<p>Every release, with its notes, is on <a href="${REPO}/releases">GitHub</a>.</p>`;
  } else {
    body += `<p>Every version of Nagma, newest first, with its notes and installers for macOS, Windows and Linux.</p>\n`;
    for (const r of releases) {
      const id = slug(r.tag_name || r.name || "release");
      const date = r.published_at || r.created_at;
      const when = date ? `<time datetime="${esc(date)}">${new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>` : "";
      const groups = PLATFORMS.map((pl) => [pl, (r.assets ?? []).filter((a) => platformOf(a.name) === pl).map((a) => ({ href: a.browser_download_url, label: a.name, note: mb(a.size) }))]).filter(([, items]) => items.length);
      body += `<section class="release">\n<h2 id="${esc(id)}">${esc(r.name || r.tag_name)}${r.prerelease ? '<span class="tag">Pre-release</span>' : ""}</h2>\n`;
      body += `<p class="rel-meta">${when}${when ? " · " : ""}<a href="${esc(r.html_url)}">${esc(r.tag_name)} on GitHub</a></p>\n`;
      if (r.body?.trim()) body += `<div class="rel-notes">\n${markdown(r.body, { headingShift: 1, idPrefix: `${id}-` })}\n</div>\n`;
      if (groups.length) body += assetCards(groups) + "\n";
      body += `</section>\n`;
    }
  }
  return { url: p.url, title: "Releases", description: "Every Nagma release with notes and installers for macOS, Windows and Linux.", body };
}

const notFound = {
  url: "/404.html",
  title: "Page not found",
  description: "There is nothing at this address.",
  body: `<h1 id="page-not-found">Not found</h1>\n<p>There's nothing at this address. Try the <a href="/">home page</a> or the <a href="/docs/getting-started/">guides</a>.</p>`,
  single: true,
};

// ---------------------------------------------------------------------------------------------
// Link check: every internal href/src on every page must reach a file (or a _redirects rule),
// and every #anchor an id on the page it points at.

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

export function checkLinks(dist = DIST) {
  const redirects = new Set(readFileSync(join(dist, "_redirects"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/)[0].replace(/\/$/, "")));
  const idCache = new Map();
  const ids = (file) => {
    if (!idCache.has(file)) idCache.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
    return idCache.get(file);
  };
  const broken = [];
  let count = 0;
  for (const file of walk(dist).filter((f) => f.endsWith(".html"))) {
    const pageUrl = "/" + relative(dist, file).split("\\").join("/").replace(/(^|\/)index\.html$/, "$1");
    const html = readFileSync(file, "utf8");
    const refs = [...html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)].map((m) => m[1]);
    for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) refs.push(...m[1].split(",").map((s) => s.trim().split(/\s+/)[0]));
    for (const raw of refs) {
      const ref = raw.replace(/&amp;/g, "&");
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
      count++;
      const u = new URL(ref, `http://site${pageUrl}`);
      const path = decodeURIComponent(u.pathname);
      const hash = decodeURIComponent(u.hash.slice(1));
      let target = null;
      if (path.endsWith("/") && existsSync(join(dist, path, "index.html"))) target = join(dist, path, "index.html");
      else if (!path.endsWith("/") && existsSync(join(dist, path)) && statSync(join(dist, path)).isFile()) target = join(dist, path);
      else if (redirects.has(path.replace(/\/$/, ""))) continue;
      if (!target) { broken.push(`${pageUrl}: ${raw} (no such file)`); continue; }
      if (hash && target.endsWith(".html") && !ids(target).has(hash)) broken.push(`${pageUrl}: ${raw} (no #${hash} on ${path})`);
    }
  }
  return { count, broken };
}

// ---------------------------------------------------------------------------------------------

async function build() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  for (const f of COPY) if (existsSync(join(LANDING, f))) cpSync(join(LANDING, f), join(DIST, f), { recursive: true });
  writeFileSync(join(DIST, "index.html"), home);
  // The reel, for review at /reel/ (not linked from the site, not indexed).
  mkdirSync(join(DIST, "reel"), { recursive: true });
  writeFileSync(join(DIST, "reel", "index.html"), readFileSync(join(LANDING, "reel.html"), "utf8").replace(/(href|src)="(fonts\/|insignia|wordmark|favicon)/g, '$1="/$2').replace(/url\("fonts\//g, 'url("/fonts/').replace(/\.src = "(insignia|wordmark)/g, '.src = "/$1'));

  const pages = [
    ...GUIDES.map(markdownPage),
    ...PROJECT.filter((p) => p.src && !p.kind).map(markdownPage),
    licencePage(PROJECT.find((p) => p.kind === "licence")),
    await releasesPage(PROJECT.find((p) => p.kind === "releases")),
    ...STUDIO.map(markdownPage),
    notFound,
  ];
  const written = [["/", join(DIST, "index.html")]];
  for (const p of pages) {
    const file = p.url.endsWith("/") ? join(DIST, p.url, "index.html") : join(DIST, p.url);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page(p));
    written.push([p.url, file]);
  }
  for (const [url, file] of written) console.log(`${url.padEnd(28)} ${(statSync(file).size / 1024).toFixed(1).padStart(7)} KB`);

  const { count, broken } = checkLinks();
  console.log(`\nlinks: ${count} internal links checked, ${broken.length} broken`);
  for (const b of broken) console.log(`  ${b}`);
  if (broken.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();

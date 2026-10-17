#!/usr/bin/env node
// Checks every link and asset in apps/landing: local files exist, #anchors exist on the page,
// shortcuts are in _redirects, links into this repository on GitHub (blob/tree/raw on main) point
// at files that exist here, and images carry width and height. `--online` also asks every external
// address (HEAD, then GET) and reports what doesn't answer 2xx or 3xx.
//
//   node tools/check-landing-links.mjs [--online]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "apps/landing");
const REPO = "https://github.com/fish-hook-studios/nagma";
const RAW = "https://raw.githubusercontent.com/fish-hook-studios/nagma/main/";
const online = process.argv.includes("--online");

const redirects = new Map(
    readFileSync(join(site, "_redirects"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/\s+/))
        .map(([from, to]) => [from, to]),
);

const problems = [];
const external = new Set();
const fail = (file, what) => problems.push(`${file}: ${what}`);

// Links into this repository: the file must exist in the checkout.
function checkRepoUrl(file, url) {
    let path = null;
    const gh = url.match(/^https:\/\/github\.com\/fish-hook-studios\/nagma\/(?:blob|tree)\/main\/(.+?)(?:#.*)?$/);
    if (gh) path = gh[1];
    else if (url.startsWith(RAW)) path = url.slice(RAW.length);
    if (path !== null && !existsSync(join(root, decodeURIComponent(path)))) fail(file, `${url} points at ${path}, which isn't in the repository`);
}

function checkUrl(file, url, ids) {
    if (url.startsWith("mailto:")) return;
    if (url.startsWith("#")) {
        if (url !== "#" && !ids.has(url.slice(1))) fail(file, `anchor ${url} has no element with that id`);
        return;
    }
    if (/^https?:\/\//.test(url)) {
        if (url.startsWith("https://nagma.app/")) return checkUrl(file, url.slice("https://nagma.app".length), ids);
        checkRepoUrl(file, url);
        external.add(url);
        return;
    }
    const path = url.split(/[?#]/)[0];
    if (redirects.has(path)) {
        const target = redirects.get(path);
        checkRepoUrl("_redirects", target);
        external.add(target);
        return;
    }
    const local = path === "/" ? join(site, "index.html") : join(site, path.replace(/^\//, ""));
    if (!existsSync(local)) fail(file, `${url} doesn't exist (and isn't in _redirects)`);
}

for (const file of readdirSync(site).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(site, file), "utf8");
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/\s(?:href|src|content)="([^"]+)"/g)) {
        const value = m[1];
        if (m[0].trim().startsWith("content=") && !/^https?:\/\//.test(value)) continue;
        checkUrl(file, value, ids);
    }
    for (const m of html.matchAll(/\s(?:srcset|imagesrcset)="([^"]+)"/g)) {
        for (const part of m[1].split(",")) checkUrl(file, part.trim().split(/\s+/)[0], ids);
    }
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
        if (!/\swidth="\d+"/.test(m[0]) || !/\sheight="\d+"/.test(m[0])) fail(file, `image without width and height: ${m[0].slice(0, 80)}`);
        if (!/\salt="/.test(m[0])) fail(file, `image without alt: ${m[0].slice(0, 80)}`);
    }
    if (/\sstyle="/.test(html)) fail(file, "inline style attribute (blocked by the CSP in _headers)");
    if (/<script(?![^>]*\ssrc=)[^>]*>/.test(html)) fail(file, "inline script (blocked by the CSP in _headers)");
    if (/—/.test(html)) fail(file, "em dash in the copy");
}

for (const [from, to] of redirects) {
    checkRepoUrl("_redirects", to);
    external.add(to);
    if (!from.startsWith("/")) fail("_redirects", `${from} isn't a path`);
}

if (online) {
    for (const url of external) {
        try {
            let res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15000) });
            if (res.status === 405 || res.status === 403) res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
            if (res.status >= 400) fail("online", `${url} answered ${res.status}`);
        } catch (err) {
            fail("online", `${url} didn't answer (${err instanceof Error ? err.message : err})`);
        }
    }
}

console.log(`Checked ${external.size} external addresses${online ? " online" : " (offline; --online to fetch them)"} and every local link in apps/landing.`);
if (problems.length) {
    for (const p of problems) console.log(`  ${p}`);
    console.error(`check-landing-links: ${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
    process.exit(1);
}
console.log("check-landing-links: all good.");
